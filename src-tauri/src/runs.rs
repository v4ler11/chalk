//! The runs: one turn per chat, alive in the backend rather than in a window.
//!
//! A run is what used to be the window's turn — the round trip, the tool loop,
//! the answer arriving, the calls waiting on the user — kept where the work
//! actually is. So closing the window closes a view and nothing else: the run
//! goes on, and a window opened later attaches to a turn already in flight.
//!
//! A window only reads (a snapshot when it opens a chat, two events while it
//! watches one) and only says what a person decides: stop, allow, decline. Every
//! other fact follows from the transcript, which is written here, once, by the
//! run that owns it — one writer per chat being the whole reason the store no
//! longer needs a save from the window at all.
//!
//! The row is the truth while a chat is idle and the run is the truth while it is
//! not, which is why a run takes the row over at its start: what it works on is
//! what the last writer left, and what it leaves behind is that transcript with
//! one more turn in it.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use parking_lot::Mutex;
use serde::Serialize;
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::mcp;
use crate::settings::AppConfig;
use crate::types::chat::Usage;
use crate::types::chat_message::{Content, Message, Part};
use crate::{assembled, log, one_round, AppState, Round, WireCall};

/// How many runs may be asking a provider at once.
///
/// A limit on the requests in flight and nothing else: a run parked on a tool
/// the user has to allow is not asking anyone anything, so it holds no place
/// here, and neither does one whose tools are running. That is what a provider's
/// rate limit is about, and this is the knob for it.
const CONCURRENCY: usize = 4;

/// How long the answer arriving waits between pushes to the windows.
///
/// A token per event would be an event per token per run. What is kept here is
/// the whole answer so far rather than the fragment, so a window that reads one
/// of these has everything up to it and one that misses it has the next.
const PUSH: Duration = Duration::from_millis(50);

/// The name the model calls to bring a lazily imported server's tools in.
pub(crate) const LOAD_TOOL_NAME: &str = "load_lazy_mcp";

/// What a call the user declined is answered with: a refusal is said rather than
/// done in silence, so the model can say why it wanted it or answer without it.
pub(crate) const DECLINED: &str = "The user declined to run this tool.";

/// Where a chat's turn stands. `Idle` is also where a run that finished sits:
/// what it did is in the transcript, and how many answers it left there is what
/// a list counts.
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Status {
    #[default]
    Idle,
    Running,
    Awaiting,
    Failed,
}

/// The answer arriving, in the shape the window already draws a response in.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Partial {
    pub answer: String,
    pub reasoning: String,
    pub started_at: i64,
    pub first_token_at: Option<i64>,
    /// True until the first answer token: while it is, the model is thinking.
    pub thinking: bool,
    /// Frozen when the answer begins; `None` while it is still to come.
    pub thinking_ms: Option<i64>,
    pub usage: Option<Usage>,
}

/// What a list needs about a run: whether it is going, whether the model has
/// said anything yet, and whether it is the user's move.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Summary {
    pub chat: i64,
    pub status: Status,
    /// True while a turn is going and no answer token has arrived — a run queued
    /// for a place among the requests is thinking, as far as a list is concerned.
    pub thinking: bool,
    /// How many messages the chat holds after its opening one: what is committed,
    /// so it stays still for the whole of a run and moves when the answer lands.
    pub replies: usize,
    pub awaiting: usize,
}

/// A chat as a window opened on it reads it: the run while there is one, and the
/// row when there is not.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Snapshot {
    pub chat: i64,
    pub status: Status,
    pub title: String,
    pub model: String,
    pub reasoning: String,
    /// The ids of the servers this chat offers; `None` while it has never
    /// chosen, which offers every enabled one.
    pub servers: Option<Vec<String>>,
    pub loaded: Vec<String>,
    pub replies: usize,
    /// The transcript: the run's own while it is live, the row's otherwise, in
    /// the shape the window stores and draws.
    pub messages: Vec<Value>,
    pub partial: Option<Partial>,
    /// The calls nobody has answered: the ones a turn stopped on, and — for a
    /// chat whose last message is an answer asking for tools — the ones a closed
    /// window left behind.
    pub awaiting: Vec<WireCall>,
    pub error: Option<String>,
}

/// The request as the model will read it, for the JSON view: the assembled
/// transcript, the tools the round would offer, and the lazily imported servers
/// it would name under the prompt. None of it is assembled by the window: what
/// the view shows is what would be sent.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Preview {
    pub messages: Vec<Message>,
    pub tools: Vec<mcp::ToolOffer>,
    pub lazy: Vec<mcp::Lazy>,
}

/// How a run was woken: a prompt to send, or calls the user has decided about.
enum Wake {
    Allowed(Vec<WireCall>),
    Declined(Vec<WireCall>),
}

/// What a run holds. It is `Inner` rather than `State` because `State` is what
/// Tauri calls the handle a command is given, and the two meet in this file.
struct Inner {
    status: Status,
    title: String,
    model: String,
    reasoning: String,
    servers: Option<Vec<String>>,
    /// The transcript in the window's own shape: it carries the timings and the
    /// usage the model is never sent, and dropping them would lose what a row of
    /// the transcript says about the answer it holds.
    messages: Vec<Value>,
    /// The servers this run has loaded. A load is one-way and belongs to the run
    /// rather than to the chat: what was imported was imported for the turn that
    /// asked, and a chat opened tomorrow starts with the laziness it was written
    /// with.
    loaded: Vec<String>,
    /// The response in flight, if there is one: absent while a run is waiting for
    /// a place among the requests, and gone the moment the answer is committed.
    partial: Option<Partial>,
    awaiting: Vec<WireCall>,
    error: Option<String>,
    /// The servers the last round could not reach. Kept because the loader has
    /// to agree with the offers: a server nobody can reach is not one the model
    /// could have been offered the loader for, so it is not one the loader may
    /// claim to have loaded.
    failed: Vec<String>,
    /// When the answer was last pushed to the windows.
    pushed: Option<Instant>,
}

/// One chat's turn.
pub(crate) struct Run {
    pub chat: i64,
    state: Mutex<Inner>,
    /// The task driving it, so that a stop can drop the request in flight: an
    /// abort is the only way to end a stream the provider has not finished.
    handle: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

/// The runs there are, by chat.
pub(crate) struct Runs {
    runs: Mutex<HashMap<i64, Arc<Run>>>,
    gate: Arc<Semaphore>,
}

impl Default for Runs {
    fn default() -> Self {
        Self::new()
    }
}

impl Runs {
    pub(crate) fn new() -> Self {
        Self {
            runs: Mutex::new(HashMap::new()),
            gate: Arc::new(Semaphore::new(CONCURRENCY)),
        }
    }

    fn get(&self, chat: i64) -> Option<Arc<Run>> {
        self.runs.lock().get(&chat).cloned()
    }

    fn put(&self, run: Arc<Run>) {
        self.runs.lock().insert(run.chat, run);
    }

    /// Every run there is, going or finished — a finished one is kept so that
    /// the transcript it holds is the one its chat is read from until the
    /// window's next write.
    fn all(&self) -> Vec<Arc<Run>> {
        let mut runs: Vec<Arc<Run>> = self.runs.lock().values().cloned().collect();
        runs.sort_by_key(|run| run.chat);
        runs
    }

    /// Drops a chat's run, stopping it if it is going: a chat that is no longer
    /// there has nothing left to answer.
    pub(crate) fn forget(&self, chat: i64) {
        if let Some(run) = self.runs.lock().remove(&chat) {
            run.abort();
        }
    }

    /// A place among the requests in flight.
    pub(crate) async fn permit(&self) -> OwnedSemaphorePermit {
        self.gate
            .clone()
            .acquire_owned()
            .await
            .expect("the gate is never closed")
    }
}

fn now() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

impl Run {
    fn new(chat: i64) -> Arc<Self> {
        Arc::new(Self {
            chat,
            state: Mutex::new(Inner {
                status: Status::Idle,
                title: String::new(),
                model: String::new(),
                reasoning: String::new(),
                servers: None,
                messages: Vec::new(),
                loaded: Vec::new(),
                partial: None,
                awaiting: Vec::new(),
                error: None,
                failed: Vec::new(),
                pushed: None,
            }),
            handle: Mutex::new(None),
        })
    }

    /// Takes a row over: its transcript, its model, its level and its servers.
    fn adopt(&self, record: crate::store::ChatRecord) {
        let mut state = self.state.lock();
        state.title = record.title;
        state.model = record.model;
        state.reasoning = record.reasoning;
        state.servers = record.servers;
        state.messages = match record.messages {
            Value::Array(messages) => messages,
            other => vec![other],
        };
        // What a closed window left behind: a transcript ending on calls nobody
        // answered is one the provider would refuse, so the calls come back as
        // the question they are rather than as a turn that cannot start.
        state.awaiting = held_calls(&state.messages);
    }

    /// Takes on what the chat is sent with next time, without touching the
    /// transcript: `chat_set` writes the row, and this keeps the same change
    /// where a window reads it. A window opening a chat that has a run reads
    /// the run rather than the row, so a level or a list of servers written to
    /// the row alone would be answered with what the run still held — which is
    /// a control that moves and springs back.
    fn retune(&self, model: String, reasoning: String, servers: Option<Vec<String>>) {
        let mut state = self.state.lock();
        state.model = model;
        state.reasoning = reasoning;
        state.servers = servers;
    }

    fn summary(&self) -> Summary {
        let state = self.state.lock();
        Summary {
            chat: self.chat,
            status: state.status,
            thinking: state.status == Status::Running
                && state
                    .partial
                    .as_ref()
                    .map(|partial| partial.thinking)
                    .unwrap_or(true),
            replies: spoken(&state.messages).saturating_sub(1),
            awaiting: state.awaiting.len(),
        }
    }

    fn snapshot(&self) -> Snapshot {
        let state = self.state.lock();
        Snapshot {
            chat: self.chat,
            status: state.status,
            title: state.title.clone(),
            model: state.model.clone(),
            reasoning: state.reasoning.clone(),
            servers: state.servers.clone(),
            loaded: state.loaded.clone(),
            replies: spoken(&state.messages).saturating_sub(1),
            messages: state.messages.clone(),
            partial: state.partial.clone(),
            awaiting: state.awaiting.clone(),
            error: state.error.clone(),
        }
    }

    fn emit_changed(&self, app: &AppHandle) {
        let _ = app.emit("run-changed", self.summary());
    }

    fn emit_partial(&self, app: &AppHandle, partial: Option<Partial>) {
        let _ = app.emit(
            "run-delta",
            json!({ "chat": self.chat, "partial": partial }),
        );
    }

    /// Says a turn is going, before it has anywhere to go: a run waiting for a
    /// place among the requests is still one the list should show as working.
    fn mark_running(&self, app: &AppHandle) {
        let mut state = self.state.lock();
        state.status = Status::Running;
        state.error = None;
        drop(state);
        self.emit_changed(app);
    }

    /// Starts a round: the clock the wait and the thinking are measured from
    /// begins at the request, not at the queue.
    fn begin(&self) {
        let mut state = self.state.lock();
        state.pushed = None;
        state.partial = Some(Partial {
            answer: String::new(),
            reasoning: String::new(),
            started_at: now(),
            first_token_at: None,
            thinking: true,
            thinking_ms: None,
            usage: None,
        });
    }

    /// Thinking arriving: the wait is over at the first token of any kind.
    pub(crate) fn push_reasoning(&self, app: &AppHandle, content: &str) {
        let pushed = {
            let mut state = self.state.lock();
            let Some(partial) = state.partial.as_mut() else {
                return;
            };
            if partial.first_token_at.is_none() {
                partial.first_token_at = Some(now());
            }
            partial.reasoning.push_str(content);
            due(&mut state)
        };
        if let Some(partial) = pushed {
            self.emit_partial(app, Some(partial));
        }
    }

    /// An answer token: the first one ends the thinking and freezes its clock.
    pub(crate) fn push_delta(&self, app: &AppHandle, content: &str) {
        let pushed = {
            let mut state = self.state.lock();
            let Some(partial) = state.partial.as_mut() else {
                return;
            };
            if partial.thinking {
                let at = now();
                let started = *partial.first_token_at.get_or_insert(at);
                partial.thinking = false;
                partial.thinking_ms = Some(at - started);
            }
            partial.answer.push_str(content);
            due(&mut state)
        };
        if let Some(partial) = pushed {
            self.emit_partial(app, Some(partial));
        }
    }

    /// What the provider said the response used, kept for the answer's own tip.
    pub(crate) fn set_usage(&self, usage: Usage) {
        let mut state = self.state.lock();
        if let Some(partial) = state.partial.as_mut() {
            partial.usage = Some(usage);
        }
    }

    /// Commits whatever arrived as a message, in the shape the transcript holds:
    /// an answer that only asked for tools is a message with no text, committed
    /// for its calls rather than skipped for its emptiness, because the request
    /// that follows carries it and a call no message holds is a transcript the
    /// provider refuses.
    fn commit(&self, app: &AppHandle, calls: Vec<WireCall>) {
        {
            let mut state = self.state.lock();
            let Some(partial) = state.partial.take() else {
                return;
            };
            let ended = now();
            let first = partial.first_token_at.unwrap_or(ended);
            let mut message = Map::new();
            message.insert("role".into(), json!("assistant"));
            if !partial.answer.is_empty() || calls.is_empty() {
                message.insert("content".into(), json!(partial.answer));
            }
            if !partial.reasoning.is_empty() {
                message.insert("reasoning".into(), json!(partial.reasoning));
            }
            // The wait is the model's silence before its first token; the
            // thinking runs from there to the answer, or to the end if it never
            // answered.
            message.insert("waitMs".into(), json!(first - partial.started_at));
            message.insert(
                "thinkingMs".into(),
                json!(partial.thinking_ms.unwrap_or(ended - first)),
            );
            if let Some(usage) = &partial.usage {
                message.insert("usage".into(), json!(usage));
            }
            if !calls.is_empty() {
                message.insert(
                    "tool_calls".into(),
                    json!(calls
                        .iter()
                        .map(|call| json!({
                            "type": "function",
                            "id": call.id,
                            "function": { "name": call.name, "arguments": call.arguments },
                        }))
                        .collect::<Vec<Value>>()),
                );
            }
            state.messages.push(Value::Object(message));
            state.pushed = None;
        }
        self.persist(app);
        self.emit_partial(app, None);
    }

    /// Runs the calls and writes what they answered into the transcript.
    fn append(&self, app: &AppHandle, answers: Vec<Value>) {
        {
            let mut state = self.state.lock();
            state.messages.extend(answers);
        }
        self.persist(app);
        self.emit_changed(app);
    }

    /// The turn is over and the answer is in.
    fn finish_turn(&self, app: &AppHandle) {
        let mut state = self.state.lock();
        state.status = Status::Idle;
        state.awaiting.clear();
        drop(state);
        self.emit_changed(app);
        self.emit_partial(app, None);
    }

    /// Stops on the user's move: the calls are held until they say.
    fn park(&self, app: &AppHandle, calls: Vec<WireCall>) {
        let mut state = self.state.lock();
        state.status = Status::Awaiting;
        state.awaiting = calls;
        drop(state);
        self.emit_changed(app);
        self.emit_partial(app, None);
    }

    fn take_awaiting(&self) -> Vec<WireCall> {
        let mut state = self.state.lock();
        std::mem::take(&mut state.awaiting)
    }

    fn fail(&self, app: &AppHandle, message: String) {
        log(app, "error", format!("run {} failed: {message}", self.chat));
        let mut state = self.state.lock();
        state.status = Status::Failed;
        state.error = Some(message);
        state.partial = None;
        state.pushed = None;
        drop(state);
        self.emit_changed(app);
        self.emit_partial(app, None);
    }

    fn abort(&self) {
        if let Some(handle) = self.handle.lock().take() {
            handle.abort();
        }
    }

    fn driving(&self, handle: tauri::async_runtime::JoinHandle<()>) {
        if let Some(previous) = self.handle.lock().replace(handle) {
            previous.abort();
        }
    }

    /// Whether this chat has a turn going, which is what a second prompt and a
    /// change of its model both have to wait for.
    fn busy(&self) -> bool {
        matches!(self.state.lock().status, Status::Running | Status::Awaiting)
    }

    /// Writes the transcript out. The title, the model, the level and the servers
    /// ride with it because the row holds them all: it is written whole or not
    /// at all, and its own copy of them is what it is written from.
    fn persist(&self, app: &AppHandle) {
        let (title, model, reasoning, servers, messages) = {
            let state = self.state.lock();
            (
                state.title.clone(),
                state.model.clone(),
                state.reasoning.clone(),
                state.servers.clone(),
                Value::Array(state.messages.clone()),
            )
        };
        let app_state = app.state::<AppState>();
        let Some(store) = app_state.store.as_ref() else {
            return;
        };
        if let Err(e) = store.save(
            Some(self.chat),
            &title,
            &model,
            &reasoning,
            servers.as_deref(),
            &messages,
            now(),
        ) {
            log(app, "error", format!("could not write chat {}: {e}", self.chat));
        }
    }

    /// The transcript as the round is sent it, with the system prompt and the
    /// lazily imported servers in front of it.
    fn request(&self, config: &AppConfig, lazy: &[mcp::Lazy]) -> Vec<Message> {
        let state = self.state.lock();
        let mut messages: Vec<Message> = state
            .messages
            .iter()
            .filter_map(|message| serde_json::from_value(message.clone()).ok())
            .collect();
        assembled(config, lazy, &mut messages);
        messages
    }

    /// The tools this round offers and the lazy servers it names in the prompt.
    ///
    /// Read afresh every round rather than once at the start: a `load_lazy_mcp`
    /// call in one round is what puts a server's tools into the next one.
    async fn offers(&self, app: &AppHandle) -> (Vec<mcp::ToolOffer>, Vec<mcp::Lazy>) {
        let servers = declared().unwrap_or_default();
        let listing = app.state::<AppState>().mcp.tools(&servers).await;
        let failed: Vec<String> = listing
            .failures
            .iter()
            .map(|failure| failure.server.clone())
            .collect();
        let (chosen, loaded) = {
            let mut state = self.state.lock();
            state.failed = failed.clone();
            (state.servers.clone(), state.loaded.clone())
        };
        let mut offers = crate::manage::tools();
        offers.extend(offers_for(
            &listing.tools,
            &servers,
            chosen.as_deref(),
            &loaded,
            &failed,
        ));
        let lazy = lazy_prompt(&listing.tools, &servers, chosen.as_deref(), &failed);
        (offers, lazy)
    }

    /// The request this run would send right now, for a window that wants to see
    /// it rather than send it.
    pub(crate) async fn preview(&self, app: &AppHandle) -> Preview {
        let (tools, lazy) = self.offers(app).await;
        let config = app.state::<AppState>().config.lock().clone();
        let messages = self.request(&config, &lazy);
        Preview {
            messages,
            tools,
            lazy,
        }
    }

    /// The server a `load_lazy_mcp` call names, of those this run may load. The
    /// model is given the server's name, so that is what is met first; the id is
    /// met too, being the half of every tool name and what a model that read the
    /// transcript rather than the prompt may say.
    fn loadable(&self, servers: &[mcp::Server], wanted: &str) -> Option<mcp::Server> {
        let (chosen, failed) = {
            let state = self.state.lock();
            (state.servers.clone(), state.failed.clone())
        };
        let asked = wanted.trim().to_lowercase();
        let here = lazy_here(servers, chosen.as_deref(), &failed);
        here.iter()
            .find(|server| label(server).to_lowercase() == asked)
            .or_else(|| {
                here.iter()
                    .find(|server| server.id.to_lowercase() == asked)
            })
            .cloned()
    }

    /// Loads a server for this run. Loading is one-way, so a second load of the
    /// same one changes nothing.
    fn load(&self, server: &mcp::Server) {
        let mut state = self.state.lock();
        if !state.loaded.contains(&server.id) {
            state.loaded.push(server.id.clone());
        }
    }
}

/// The run for a chat, made from its row when it has none: a window opening a
/// chat the backend is not working on reads that row through the same shape it
/// reads a run with, so there is one way to open a thread rather than two.
///
/// `None` when the chat is gone, which is a row deleted under a window that
/// still had it listed.
pub(crate) fn ensure(state: &AppState, chat: i64) -> Result<Option<Arc<Run>>, String> {
    if let Some(run) = state.runs.get(chat) {
        return Ok(Some(run));
    }
    let store = state.store.as_ref().ok_or("the history is not open")?;
    let Some(record) = store.load(chat)? else {
        return Ok(None);
    };
    let run = Run::new(chat);
    run.adopt(record);
    state.runs.put(run.clone());
    Ok(Some(run))
}

/// Whether the answer arriving is due to be pushed to the windows.
fn due(state: &mut Inner) -> Option<Partial> {
    let ready = state
        .pushed
        .map(|at| at.elapsed() >= PUSH)
        .unwrap_or(true);
    if !ready {
        return None;
    }
    state.pushed = Some(Instant::now());
    state.partial.clone()
}

/// How many messages a thread has said since the prompt that opened it: the
/// user's own words and the model's answers, counted together, with the tools'
/// results left out. A result is a record of what was done rather than anything
/// said, so a turn that called three tools and then answered has said two
/// things and not five — which is what a row offers to read.
///
/// Read off the transcript rather than kept beside it, because it is the one
/// value in a row that can be derived without guessing. The store derives it
/// the same way, in the query a list is drawn from.
fn spoken(messages: &[Value]) -> usize {
    messages
        .iter()
        .filter(|message| {
            matches!(
                message.get("role").and_then(Value::as_str),
                Some("user") | Some("assistant")
            )
        })
        .count()
}

/// The calls a transcript ends on unanswered, which are the ones a chat opened
/// again has to ask about.
fn held_calls(messages: &[Value]) -> Vec<WireCall> {
    let Some(Value::Object(last)) = messages.last() else {
        return Vec::new();
    };
    if last.get("role").and_then(Value::as_str) != Some("assistant") {
        return Vec::new();
    }
    last.get("tool_calls")
        .and_then(Value::as_array)
        .map(|calls| {
            calls
                .iter()
                .filter_map(|call| {
                    let function = call.get("function")?;
                    Some(WireCall {
                        id: call.get("id")?.as_str()?.to_string(),
                        name: function.get("name")?.as_str()?.to_string(),
                        arguments: function
                            .get("arguments")
                            .and_then(Value::as_str)
                            .unwrap_or_default()
                            .to_string(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The servers as `mcp.json` declares them.
fn declared() -> Result<Vec<mcp::Server>, String> {
    let path = mcp::path()?;
    mcp::read(&path)
}

/// What a server is called where a name is wanted: what the user wrote, or its
/// id when they wrote nothing.
fn label(server: &mcp::Server) -> String {
    if server.name.trim().is_empty() {
        server.id.clone()
    } else {
        server.name.clone()
    }
}

/// The servers a chat offers: every enabled one while it has never chosen, and
/// its choice met with them once it has — a server switched off in the settings
/// window is off for a chat that had it on.
fn offered(servers: &[mcp::Server], chosen: Option<&[String]>) -> Vec<String> {
    let enabled: Vec<&mcp::Server> = servers.iter().filter(|server| server.enabled).collect();
    match chosen {
        None => enabled.iter().map(|server| server.id.clone()).collect(),
        Some(ids) => enabled
            .iter()
            .filter(|server| ids.contains(&server.id))
            .map(|server| server.id.clone())
            .collect(),
    }
}

/// The lazily imported servers a chat calls and can reach: laziness is what the
/// prompt is for, and a server nobody can reach cannot be loaded either, so it
/// is not offered to the model as a thing it could ask for.
fn lazy_here(servers: &[mcp::Server], chosen: Option<&[String]>, failed: &[String]) -> Vec<mcp::Server> {
    let here = offered(servers, chosen);
    servers
        .iter()
        .filter(|server| {
            server.lazy
                && server.enabled
                && here.contains(&server.id)
                && !failed.contains(&server.id)
        })
        .cloned()
        .collect()
}

/// The lazy servers still to load: the ones the prompt lists. A server this run
/// has loaded is not among them, so what the prompt says shrinks as the turn
/// goes on — while the loader stays offered, so that a server loaded once can be
/// named again without the tool vanishing under the model.
fn waiting(
    servers: &[mcp::Server],
    chosen: Option<&[String]>,
    failed: &[String],
    loaded: &[String],
) -> Vec<mcp::Server> {
    lazy_here(servers, chosen, failed)
        .into_iter()
        .filter(|server| !loaded.contains(&server.id))
        .collect()
}

/// The tool that does the loading, spelled once: it belongs to the app rather
/// than to any server, and it is run without asking — it costs nothing, reaches
/// nothing, and does nothing but widen what the model may call next.
pub(crate) fn load_tool() -> mcp::ToolOffer {
    mcp::ToolOffer {
        name: LOAD_TOOL_NAME.to_string(),
        server: String::new(),
        server_name: String::new(),
        title: "Load a lazily imported MCP server".to_string(),
        description: "Load the tools of a lazily imported MCP server into this conversation, so they \
                      can be called. Call it with the server's name as listed under Lazy Imported \
                      MCPs in the system prompt, once you need what that server offers."
            .to_string(),
        parameters: json!({
            "type": "object",
            "properties": {
                "name": { "type": "string", "description": "The name of the lazily imported server to load." }
            },
            "required": ["name"]
        }),
        auto_run: true,
    }
}

/// The servers' tools as a round is sent them: the chosen servers' own, with the
/// lazy ones among them left out until this run has loaded them, and the loader
/// itself while any lazy server is still reachable. The app's own tools are not
/// filtered here — they are not a chat's to choose — and the caller adds them.
fn offers_for(
    tools: &[mcp::ToolOffer],
    servers: &[mcp::Server],
    chosen: Option<&[String]>,
    loaded: &[String],
    failed: &[String],
) -> Vec<mcp::ToolOffer> {
    let here = offered(servers, chosen);
    let lazy: Vec<&str> = servers
        .iter()
        .filter(|server| server.lazy)
        .map(|server| server.id.as_str())
        .collect();
    let mut sent: Vec<mcp::ToolOffer> = tools
        .iter()
        .filter(|tool| {
            here.contains(&tool.server)
                && (!lazy.contains(&tool.server.as_str()) || loaded.contains(&tool.server))
        })
        .cloned()
        .collect();
    if !lazy_here(servers, chosen, failed).is_empty() {
        sent.push(load_tool());
    }
    sent
}

/// What the system prompt is told about this chat's lazy servers: each one still
/// waiting, named and described, with the names of the tools it holds — the
/// names the model will call, since those cost a line where their definitions
/// would cost the whole weight laziness is saving.
fn lazy_prompt(
    tools: &[mcp::ToolOffer],
    servers: &[mcp::Server],
    chosen: Option<&[String]>,
    failed: &[String],
) -> Vec<mcp::Lazy> {
    waiting(servers, chosen, failed, &[])
        .iter()
        .map(|server| mcp::Lazy {
            name: label(server),
            description: server.description.clone(),
            tools: tools
                .iter()
                .filter(|tool| tool.server == server.id)
                .map(|tool| tool.name.clone())
                .collect(),
        })
        .collect()
}

/// The name a `load_lazy_mcp` call asks for, out of the JSON arguments the model
/// wrote. Anything that is not an object carrying a name is no name at all,
/// which the loader says back rather than guessing at.
fn wanted_name(arguments: &str) -> String {
    let Ok(parsed) = serde_json::from_str::<Value>(arguments) else {
        return String::new();
    };
    parsed
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

/// The words of a content, which is what a title is made of.
fn text_of(content: &Content) -> String {
    match content {
        Content::Text(text) => text.clone(),
        Content::Parts(parts) => parts
            .iter()
            .filter_map(|part| match part {
                Part::Text { text, .. } => Some(text.as_str()),
                _ => None,
            })
            .collect::<Vec<&str>>()
            .join(" "),
    }
}

/// The name a chat is born with: its first prompt, on one line, cut to what a
/// row can hold. It only ever seeds a title, and a title is the row's after that.
fn title_from(content: &Content) -> String {
    let text = text_of(content)
        .split_whitespace()
        .collect::<Vec<&str>>()
        .join(" ");
    if text.is_empty() {
        return "New thread".to_string();
    }
    match text.char_indices().nth(41) {
        Some((cut, _)) => format!("{}…", &text[..cut]),
        None => text,
    }
}

/// One tool result, in the shape the transcript holds it: a tool's own failure
/// and the user's refusal travel as text, because the completions shape has no
/// error flag for a result.
fn tool_message(call: &WireCall, text: String, ms: u64) -> Value {
    json!({
        "role": "tool",
        "tool_call_id": call.id,
        "name": call.name,
        "content": text,
        "ms": ms,
    })
}

/* --------------------------------------------------------------- the turn */

/// Drives a run to the end of its turn: a round trip, the tools it asked for,
/// and another round, until it answers without asking for one.
///
/// A call belonging to a server that may not run unasked does not run here: the
/// turn stops with the calls waiting and the user decides. There is no round cap
/// and none is wanted: a turn that asks forever is visible in its transcript and
/// stopped by hand, where a number picked here would cut off an honest turn that
/// simply had more work to do.
async fn drive(app: AppHandle, run: Arc<Run>) {
    loop {
        let (offers, lazy) = run.offers(&app).await;
        let config = app.state::<AppState>().config.lock().clone();
        let (model, reasoning) = {
            let state = run.state.lock();
            (state.model.clone(), state.reasoning.clone())
        };
        // Off is not the absence of the field: leaving it out lets a model that
        // reasons by default go on doing so, which reads as the control not
        // working. It is the gateways' own spelling for "do not reason", and
        // anything that is not a level a model can be asked for is read as off
        // rather than sent as a typo.
        let reasoning = crate::reasoning_level(Some(reasoning));
        let messages = run.request(&config, &lazy);
        // A place among the requests in flight is held around the round trip and
        // nothing else: the tools that follow, and the user's answer when a call
        // waits on one, are not asking a provider anything.
        let permit = app.state::<AppState>().runs.permit().await;
        run.begin();
        run.emit_changed(&app);
        let round: Round = one_round(
            app.clone(),
            config,
            model,
            reasoning,
            messages,
            Some(offers.clone()),
            &run,
        )
        .await;
        drop(permit);
        if round.failed {
            run.fail(&app, round.message);
            return;
        }
        let calls = round.calls;
        // The answer that asked for the calls is committed before they are run:
        // a result answers a call, and the call lives in that message.
        run.commit(&app, calls.clone());
        if calls.is_empty() {
            run.finish_turn(&app);
            return;
        }
        let allowed = calls.iter().all(|call| {
            offers
                .iter()
                .find(|offer| offer.name == call.name)
                .map(|offer| offer.auto_run)
                .unwrap_or(false)
        });
        if !allowed {
            run.park(&app, calls);
            return;
        }
        let answers = answer(&app, &run, &calls).await;
        run.append(&app, answers);
    }
}

/// Answers the calls the user decided about, and lets the turn go on.
async fn resume(app: AppHandle, run: Arc<Run>, wake: Wake) {
    let answers = match wake {
        Wake::Allowed(calls) => answer(&app, &run, &calls).await,
        Wake::Declined(calls) => calls
            .iter()
            .map(|call| tool_message(call, DECLINED.to_string(), 0))
            .collect(),
    };
    run.append(&app, answers);
    drive(app, run).await;
}

/// Runs the calls, in parallel: each is a question asked somewhere else, and one
/// slow tool should not hold up the rest of the answer.
async fn answer(app: &AppHandle, run: &Arc<Run>, calls: &[WireCall]) -> Vec<Value> {
    let mut handles = Vec::new();
    for call in calls {
        let app = app.clone();
        let run = run.clone();
        let call = call.clone();
        handles.push(tauri::async_runtime::spawn(async move {
            call_tool(&app, &run, &call).await
        }));
    }
    let mut answers = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(answer) => answers.push(answer),
            Err(e) => log(app, "error", format!("a tool call did not come back: {e}")),
        }
    }
    answers
}

/// Runs one call and answers with what the model is told about it.
async fn call_tool(app: &AppHandle, run: &Arc<Run>, call: &WireCall) -> Value {
    let started = Instant::now();
    // The loader is the app's own rather than a server's, so it is answered
    // here: no server is reached, and what changes is this run's own state.
    if call.name == LOAD_TOOL_NAME {
        let wanted = wanted_name(&call.arguments);
        let servers = declared().unwrap_or_default();
        let Some(server) = run.loadable(&servers, &wanted) else {
            return tool_message(
                call,
                format!("No lazily imported server is called \"{wanted}\"."),
                started.elapsed().as_millis() as u64,
            );
        };
        run.load(&server);
        return tool_message(
            call,
            format!(
                "The {} server is loaded. Its tools can be called from now on.",
                label(&server)
            ),
            started.elapsed().as_millis() as u64,
        );
    }
    let state = app.state::<AppState>();
    // The app's own tools are answered by `manage`, against the very files the
    // settings window writes.
    let answer = if crate::manage::owns(&call.name) {
        crate::manage::call(app, &state, &call.name, Some(&call.arguments)).await
    } else {
        state.mcp.call(&call.name, Some(call.arguments.clone())).await
    };
    match answer {
        Ok(result) => {
            // An empty answer is still an answer — the model learns the tool ran
            // — where no message at all would read as a tool that never came back.
            let text = if result.text.trim().is_empty() {
                "The tool answered nothing.".to_string()
            } else {
                result.text
            };
            let said = if result.is_error {
                format!("The tool failed: {text}")
            } else {
                text
            };
            tool_message(call, said, result.ms)
        }
        Err(e) => tool_message(
            call,
            format!("The tool could not be run: {e}"),
            started.elapsed().as_millis() as u64,
        ),
    }
}

/* ----------------------------------------------------------- the commands */

/// What a post answers with: the chat the prompt became.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Started {
    pub chat: i64,
}

/// Sends a prompt into a chat, starting its turn.
///
/// With no chat named, one is made from the prompt: that is what posting to the
/// channel is, and why there is no New Thread button — the message is the
/// thread. `keep` cuts the transcript to its first so many messages before the
/// prompt is added, which is how editing a prompt and asking again start the
/// turn over from there.
#[tauri::command]
pub(crate) async fn run_start(
    app: AppHandle,
    state: State<'_, AppState>,
    chat: Option<i64>,
    content: Content,
    model: Option<String>,
    reasoning: Option<String>,
    servers: Option<Vec<String>>,
    keep: Option<usize>,
) -> Result<Started, String> {
    let config = state.config.lock().clone();
    let store = state.store.as_ref().ok_or("the history is not open")?;

    // One turn at a time per chat: a second prompt while one is in flight would
    // be a second writer for one transcript.
    if let Some(chat) = chat {
        if state.runs.get(chat).map(|run| run.busy()).unwrap_or(false) {
            return Err("this thread is still answering".to_string());
        }
    }

    let model = model.filter(|model| !model.trim().is_empty());
    // The prompt carries when it was sent: the request heads every prompt with
    // the time and the gap since the one before it, and that header has to be the
    // same bytes on every later request, or a provider's prompt cache cannot find
    // the prefix again.
    let prompt = json!({ "role": "user", "content": content, "sentAt": now() });

    let record = match chat {
        Some(chat) => {
            let record = store.load(chat)?.ok_or("that thread is gone")?;
            let mut messages = match record.messages {
                Value::Array(messages) => messages,
                other => vec![other],
            };
            // An edited prompt, and an answer asked again, both start the turn
            // over from where they are: what the transcript had after that point
            // is exactly what the new turn replaces.
            if let Some(keep) = keep {
                messages.truncate(keep);
            }
            messages.push(prompt);
            let messages = Value::Array(messages);
            let model = model.clone().unwrap_or(record.model);
            let reasoning = reasoning.clone().unwrap_or(record.reasoning);
            let servers = servers.clone().or(record.servers);
            // The row is written here, whole, rather than by the run a moment
            // later: what a post changes is what the row holds, and one write is
            // one moment at which it is true.
            store.save(
                Some(chat),
                &record.title,
                &model,
                &reasoning,
                servers.as_deref(),
                &messages,
                now(),
            )?;
            crate::store::ChatRecord {
                id: chat,
                title: record.title,
                model,
                reasoning,
                servers,
                messages,
            }
        }
        None => {
            // A new chat is born with the prompt: the row and its first message
            // arrive together, so a post to the channel is one write and there is
            // no moment at which a thread exists with nothing in it.
            let born = store.save(
                None,
                &title_from(&content),
                model.as_deref().unwrap_or_else(|| first_model(&config)),
                reasoning.as_deref().unwrap_or(""),
                servers.as_deref(),
                &json!([prompt]),
                now(),
            )?;
            store.load(born.id)?.ok_or("the thread could not be read back")?
        }
    };

    let run = state
        .runs
        .get(record.id)
        .unwrap_or_else(|| Run::new(record.id));
    run.adopt(record);
    {
        let mut held = run.state.lock();
        // A row written before there were models to hold still has a turn to make
        // in it, and it is asked with the head of the settings' list.
        if held.model.is_empty() {
            held.model = first_model(&config).to_string();
        }
    }
    state.runs.put(run.clone());
    run.mark_running(&app);
    let driving = run.clone();
    run.driving(tauri::async_runtime::spawn(async move {
        drive(app, driving).await
    }));
    Ok(Started { chat: run.chat })
}

/// The model a chat with none starts from: the head of the settings' list, and a
/// row someone left empty in there is not one to ask a provider for.
fn first_model(config: &AppConfig) -> &str {
    config
        .models
        .iter()
        .find(|model| !model.trim().is_empty())
        .map(String::as_str)
        .unwrap_or("")
}

/// Stops the turn: whatever arrived stays as the answer, and the request in
/// flight is dropped — an abort being the only way to end a stream the provider
/// has not finished.
#[tauri::command]
pub(crate) fn run_stop(app: AppHandle, state: State<'_, AppState>, chat: i64) {
    let Some(run) = state.runs.get(chat) else {
        return;
    };
    run.abort();
    run.commit(&app, Vec::new());
    run.finish_turn(&app);
    log(&app, "info", format!("run {chat} stopped"));
}

/// Runs the calls that were waiting on the user, and asks the model again.
#[tauri::command]
pub(crate) fn run_allow(app: AppHandle, state: State<'_, AppState>, chat: i64) -> Result<(), String> {
    let run = state.runs.get(chat).ok_or("that thread has no turn")?;
    let calls = run.take_awaiting();
    if calls.is_empty() {
        return Ok(());
    }
    run.mark_running(&app);
    let driving = run.clone();
    run.driving(tauri::async_runtime::spawn(async move {
        resume(app, driving, Wake::Allowed(calls)).await
    }));
    Ok(())
}

/// Answers the calls without running them: a refusal is said, so the model can
/// say why it wanted them or answer without them.
#[tauri::command]
pub(crate) fn run_decline(app: AppHandle, state: State<'_, AppState>, chat: i64) -> Result<(), String> {
    let run = state.runs.get(chat).ok_or("that thread has no turn")?;
    let calls = run.take_awaiting();
    if calls.is_empty() {
        return Ok(());
    }
    run.mark_running(&app);
    let driving = run.clone();
    run.driving(tauri::async_runtime::spawn(async move {
        resume(app, driving, Wake::Declined(calls)).await
    }));
    Ok(())
}

/// One chat as a window opened on it reads it: the run while there is one, the
/// row when there is not.
#[tauri::command]
pub(crate) fn run_state(state: State<'_, AppState>, chat: i64) -> Result<Option<Snapshot>, String> {
    Ok(ensure(&state, chat)?.map(|run| run.snapshot()))
}

/// Every run there is, for a list to draw against. A run that has finished is
/// answered too: it is where the chat's transcript was left, and what a window
/// opened on it reads.
#[tauri::command]
pub(crate) fn runs_state(state: State<'_, AppState>) -> Vec<Summary> {
    state.runs.all().iter().map(|run| run.summary()).collect()
}

/// Changes what a chat is sent with next time: its model, its reasoning level,
/// or the servers it offers. A key that is absent is left as it was, and a
/// `servers` of `null` is a chat that has never chosen, which offers every
/// enabled server rather than none.
///
/// Refused while the chat is answering, because the row is written whole: a
/// write of a model into a row whose transcript another writer is halfway
/// through would put the row back to where this window last saw it.
///
/// The row is not the only copy: a chat with a run is read through the run, so
/// the change is put there too, or the next read would answer with what the run
/// still held.
#[tauri::command]
pub(crate) fn chat_set(
    app: AppHandle,
    state: State<'_, AppState>,
    chat: i64,
    model: Option<String>,
    reasoning: Option<String>,
    servers: Option<Option<Vec<String>>>,
) -> Result<(), String> {
    if state.runs.get(chat).map(|run| run.busy()).unwrap_or(false) {
        return Err("this thread is still answering".to_string());
    }
    let store = state.store.as_ref().ok_or("the history is not open")?;
    let record = store.load(chat)?.ok_or("that thread is gone")?;
    let model = model.unwrap_or(record.model);
    let reasoning = reasoning.unwrap_or(record.reasoning);
    let servers = servers.unwrap_or(record.servers);
    store.save(
        Some(chat),
        &record.title,
        &model,
        &reasoning,
        servers.as_deref(),
        &record.messages,
        now(),
    )?;
    if let Some(run) = state.runs.get(chat) {
        run.retune(model, reasoning, servers);
        run.emit_changed(&app);
    }
    Ok(())
}

#[cfg(test)]
#[path = "tests/runs.rs"]
mod tests;
