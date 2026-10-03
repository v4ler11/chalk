pub mod logging;
pub mod mcp;
pub mod settings;
pub mod store;
pub mod types;

use chrono::{DateTime, FixedOffset, Local};
use futures_util::StreamExt;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::{ipc::Channel, Emitter, Manager, State, WebviewWindowBuilder};

use logging::{now_millis, LogEntry, Logger};
use settings::{AppConfig, Settings};
use store::{ChatRecord, ChatSummary, Store};
use types::chat::{Chunk, Post, ReasoningConfig, StreamOptions, Tool, Usage};
use types::chat_message::{Message, ToolCallChunk};

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
enum StreamEvent {
    Reasoning { content: String },
    Delta { content: String },
    Usage { usage: Usage },
    /// The tools the model asked for, once the stream has assembled them: the
    /// arguments of a call arrive in pieces, and a call whose arguments are half
    /// delivered is not one to act on.
    ToolCalls { calls: Vec<WireCall> },
    Done,
    Error { message: String },
}

/// One tool call as the model asked for it.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct WireCall {
    /// The provider's id for the call, which the answer must carry back.
    id: String,
    /// The tool's name, as the request offered it.
    name: String,
    /// The arguments, as the JSON text the provider streamed.
    arguments: String,
}

struct AppState {
    config: Mutex<AppConfig>,
    client: reqwest::Client,
    logger: Logger,
    /// The model context protocol servers, and the connections to them.
    mcp: mcp::Client,
    /// Chat history. `None` when the database could not be opened: the chat
    /// itself still works, and every history command reports why it does not.
    store: Option<Store>,
    /// The running stream, so [`stop_stream`] can abort it.
    inflight: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
}

/// Records a log entry in the in-memory buffer, on stderr, and live to the webview.
fn log(app: &tauri::AppHandle, level: &str, message: impl Into<String>) {
    let entry = app.state::<AppState>().logger.push(level, message.into());
    eprintln!("[{}] {}", entry.level, entry.message);
    let _ = app.emit("app-log", entry);
}

/// Char-boundary-safe truncation, used to keep logged/returned text bounded.
fn truncate(s: String, max: usize) -> String {
    if s.chars().count() <= max {
        return s;
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

/// The reasoning level a request is asked with.
///
/// Off is not the absence of the field: leaving it out lets a model that reasons
/// by default go on doing so, which reads as the control not working. It is
/// `none`, the gateways' own spelling for "do not reason" — and so is anything
/// else that is not a level a model can be asked for, since a request over a typo
/// should not quietly go out without the answer the user asked for.
fn reasoning_level(level: Option<String>) -> String {
    match level.as_deref() {
        Some(level @ ("low" | "medium" | "high")) => level.to_owned(),
        _ => "none".to_owned(),
    }
}

/// Reads the settings, writing the file out on the first run.
fn load_config(app: &tauri::AppHandle) -> Result<AppConfig, String> {
    let path = settings::path()?;
    if path.exists() {
        return settings::read(&path).map(|settings| AppConfig::from(&settings));
    }
    // A first run takes up whatever the app kept before the settings moved into
    // the home directory, so the key already in use is not lost to the move.
    let settings = carried_over(app).unwrap_or_else(settings::defaults);
    settings::write_to(&path, &settings)?;
    Ok(AppConfig::from(&settings))
}

/// What the app kept before the settings moved: `config.json`, in the OS
/// app-config directory, read once when there is no settings file yet. This can
/// go a release after the move, once nothing is carrying anything over.
fn carried_over(app: &tauri::AppHandle) -> Option<Settings> {
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Legacy {
        api_base: String,
        api_key: String,
        model: String,
    }

    let dir = app.path().app_config_dir().ok()?;
    let raw = std::fs::read_to_string(dir.join("config.json")).ok()?;
    let old: Legacy = serde_json::from_str(&raw).ok()?;
    // The old base URL becomes the provider, which an endpoint passes through,
    // and its one model becomes the list's first entry.
    Some(Settings {
        provider: old.api_base,
        api_key: old.api_key,
        models: vec![old.model],
        system_prompt: String::new(),
    })
}

/// Writes the settings back out to the file the user edits.
fn persist_config(cfg: &AppConfig) -> Result<(), String> {
    settings::write_to(&settings::path()?, &Settings::from(cfg))
}

/// Opens the chat history database in the app's data directory.
fn open_store(app: &tauri::AppHandle) -> Result<Store, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Store::open(&dir.join("chats.db"))
}

/// Runs a history call, logging whatever it failed with: a history that cannot be
/// read or written has to leave a trace somewhere.
fn history<T>(app: &tauri::AppHandle, what: &str, result: Result<T, String>) -> Result<T, String> {
    if let Err(e) = &result {
        log(app, "error", format!("{what}: {e}"));
    }
    result
}

/// The history store, or the reason there is none.
fn history_store(state: &AppState) -> Result<&Store, String> {
    state
        .store
        .as_ref()
        .ok_or_else(|| "the chat history is unavailable".to_string())
}

#[tauri::command]
fn get_config(state: State<'_, AppState>) -> AppConfig {
    state.config.lock().clone()
}

#[tauri::command]
fn save_config(app: tauri::AppHandle, state: State<'_, AppState>, config: AppConfig) -> Result<AppConfig, String> {
    if let Err(e) = persist_config(&config) {
        log(&app, "error", format!("failed to save settings: {e}"));
        return Err(e);
    }
    *state.config.lock() = config.clone();
    // The other windows re-read the config; the model chip in the title bar is
    // the visible consequence.
    let _ = app.emit("config-changed", ());
    log(
        &app,
        "info",
        format!(
            "settings saved; models=[{}] provider={}",
            config.models.join(", "),
            config.provider
        ),
    );
    Ok(config)
}

/// Shows and focuses one of the app's windows.
///
/// Each is declared in `tauri.conf.json` and built at startup, hidden. Closing
/// one destroys it, so it is rebuilt here from that same declaration — one
/// source of truth for its size, chrome and URL, rather than a second one in
/// Rust that could drift from the config.
fn show_window(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let window = match app.get_webview_window(label) {
        Some(window) => window,
        None => {
            let config = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == label)
                .cloned()
                .ok_or_else(|| {
                    log(app, "error", format!("the {label} window is not declared"));
                    format!("the {label} window is not declared")
                })?;
            WebviewWindowBuilder::from_config(app, &config)
                .and_then(|builder| builder.build())
                .map_err(|e| {
                    log(app, "error", format!("could not build the {label} window: {e}"));
                    e.to_string()
                })?
        }
    };
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())?;
    Ok(())
}

/// Shows and focuses the settings window.
#[tauri::command]
fn open_settings(app: tauri::AppHandle) -> Result<(), String> {
    show_window(&app, "settings")
}

/// Shows and focuses the log window.
#[tauri::command]
fn open_logs(app: tauri::AppHandle) -> Result<(), String> {
    show_window(&app, "logs")
}

#[tauri::command]
fn get_logs(state: State<'_, AppState>) -> Vec<LogEntry> {
    state.logger.snapshot()
}

/// The chat history, most recently written first.
#[tauri::command]
fn list_chats(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<Vec<ChatSummary>, String> {
    history(&app, "could not list the chats", history_store(&state).and_then(|store| store.list()))
}

/// One chat, with its transcript. `None` when that chat is gone.
#[tauri::command]
fn load_chat(app: tauri::AppHandle, state: State<'_, AppState>, id: i64) -> Result<Option<ChatRecord>, String> {
    history(&app, "could not load the chat", history_store(&state).and_then(|store| store.load(id)))
}

/// Writes a chat: creates it when `id` is null, and otherwise replaces that
/// chat's title, model, reasoning level, servers and transcript. Returns the
/// row, so a new chat learns its id.
///
/// `servers` is the choice the chat has made about which model context protocol
/// servers it is sent with, and `None` is a chat that has never made one — which
/// offers every enabled server.
#[tauri::command]
fn save_chat(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    id: Option<i64>,
    title: String,
    model: String,
    reasoning: String,
    servers: Option<Vec<String>>,
    messages: serde_json::Value,
) -> Result<ChatSummary, String> {
    let saved = history(
        &app,
        "could not save the chat",
        history_store(&state).and_then(|store| {
            store.save(id, &title, &model, &reasoning, servers.as_deref(), &messages, now_millis())
        }),
    )?;
    // Only a chat that has just come into being is worth a line; every other save
    // is routine and would bury the log.
    if id.is_none() {
        log(&app, "info", format!("chat {} created: {}", saved.id, saved.title));
    }
    Ok(saved)
}

/// Renames a chat, leaving its transcript alone.
#[tauri::command]
fn rename_chat(app: tauri::AppHandle, state: State<'_, AppState>, id: i64, title: String) -> Result<(), String> {
    history(
        &app,
        "could not rename the chat",
        history_store(&state).and_then(|store| store.rename(id, &title)),
    )?;
    log(&app, "info", format!("chat {id} renamed: {title}"));
    Ok(())
}

/// Removes a chat and its transcript.
#[tauri::command]
fn delete_chat(app: tauri::AppHandle, state: State<'_, AppState>, id: i64) -> Result<(), String> {
    history(&app, "could not delete the chat", history_store(&state).and_then(|store| store.delete(id)))?;
    log(&app, "info", format!("chat {id} deleted"));
    Ok(())
}

/// How a variable's value is written wherever the prompt asks for it:
/// `Fri 2 Oct 2026 20:39:02` — the day of the week, the date, then the time.
const STAMP: &str = "%a %-d %b %Y %H:%M:%S";

/// What the variables in the system prompt stand for at this moment.
fn variables(now: DateTime<FixedOffset>) -> [(&'static str, String); 1] {
    [("TODAY", now.format(STAMP).to_string())]
}

/// The system prompt with every `@{{NAME}}` filled in.
///
/// A name the app does not know is left as written — a typo stays visible in the
/// prompt rather than quietly becoming nothing.
fn expand_at(prompt: &str, now: DateTime<FixedOffset>) -> String {
    let mut out = prompt.to_owned();
    for (name, value) in variables(now) {
        out = out.replace(&["@{{", name, "}}"].concat(), &value);
    }
    out
}

/// [`expand_at`] at this moment, in the user's own time zone.
fn expand(prompt: &str) -> String {
    expand_at(prompt, Local::now().fixed_offset())
}

/// Puts the configured system prompt in front of a transcript, when there is
/// one, and names the lazily imported servers under it.
///
/// This happens on the way out rather than in the window: a system message
/// belongs to the request, so prepending it where the transcript is held would
/// put it in every chat the store is given. A prompt that is only whitespace is
/// not a prompt. Its variables are resolved here too, so a prompt stored as
/// `@{{TODAY}}` carries the time of each send rather than the time it was saved.
///
/// The lazy servers are named after it, because that is the whole of what the
/// model is told about them: their tools are not in the request, so all it can
/// be given is what they are called and what they are for. A server this chat
/// has already loaded is not among them — by then it is an ordinary server, and
/// its tools are in the request itself. What the model does with the list is
/// what the `load_lazy_mcp` tool is for.
fn with_system_prompt(prompt: &str, lazy: &[mcp::Lazy], messages: &mut Vec<Message>) {
    let mut said = expand(prompt).trim_end().to_string();
    if !lazy.is_empty() {
        if !said.is_empty() {
            said.push('\n');
        }
        said.push_str("Lazy Imported MCPs:");
        for server in lazy {
            said.push('\n');
            // A description is the user's to write, and a server may be declared
            // without one: then its name is all there is to say about it.
            if server.description.trim().is_empty() {
                said.push_str(&server.name);
            } else {
                said.push_str(&format!("{}: {}", server.name, server.description));
            }
            // What it holds, by name and nothing more: the definitions are
            // exactly what the model is not being sent, and the names are enough
            // for it to tell whether this is the server it wants.
            if !server.tools.is_empty() {
                said.push_str(&format!("\n  tools: {}", server.tools.join(", ")));
            }
        }
    }
    if !said.trim().is_empty() {
        messages.insert(0, Message::system(said));
    }
}

/// Starts one completion and returns immediately: the stream, its failures and
/// its usage all come back on `on_event`, because the command is no longer alive
/// to return them.
///
/// The tools are the ones the frontend was offered for this turn, and are passed
/// through rather than looked up here: what a request offers the model is the
/// frontend's business — it is what asks for the calls to be carried out — and
/// the tools it names are the ones it can act on. The lazily imported servers
/// are passed the same way, for the same reason: which of them this chat has
/// loaded is the chat's own state, and all the backend does with the list is
/// name them in the prompt.
#[tauri::command]
fn chat(app: tauri::AppHandle, state: State<'_, AppState>, messages: Vec<Message>, model: Option<String>, reasoning: Option<String>, tools: Option<Vec<mcp::ToolOffer>>, lazy: Option<Vec<mcp::Lazy>>, on_event: Channel<StreamEvent>) -> Result<(), String> {
    let config = state.config.lock().clone();
    // The chat's own model, or the head of the configured list: a chat that has
    // never been given one follows the settings rather than asking for nothing.
    let model = model
        .filter(|m| !m.trim().is_empty())
        // The first real model in the list: a row someone left empty in the
        // settings window is not one to ask a provider for.
        .or_else(|| {
            config
                .models
                .iter()
                .find(|m| !m.trim().is_empty())
                .cloned()
        })
        .unwrap_or_default();
    // Off asks for no reasoning rather than leaving the model to think by
    // default, so the control means what it says.
    let reasoning = reasoning_level(reasoning);

    let mut messages = messages;
    with_system_prompt(&config.system_prompt, &lazy.unwrap_or_default(), &mut messages);

    // One stream at a time: a new request replaces whatever is still running.
    if let Some(previous) = state.inflight.lock().take() {
        previous.abort();
    }
    let handle = tauri::async_runtime::spawn(stream_chat(app, config, model, reasoning, messages, tools, on_event));
    *state.inflight.lock() = Some(handle);
    Ok(())
}

/// Aborts the stream [`chat`] started, if it is still running.
#[tauri::command]
fn stop_stream(app: tauri::AppHandle, state: State<'_, AppState>) {
    if let Some(handle) = state.inflight.lock().take() {
        handle.abort();
        log(&app, "info", "stream stopped by frontend");
    }
}

/* ---------------------------------------------------------------------- mcp */

/// The servers as `mcp.json` holds them, for the settings window to edit.
#[tauri::command]
fn mcp_servers(app: tauri::AppHandle) -> Result<Vec<mcp::Server>, String> {
    let path = mcp::path()?;
    let servers = mcp::read(&path).map_err(|e| {
        log(&app, "error", format!("could not read the servers: {e}"));
        e
    })?;
    Ok(servers)
}

/// Writes the servers to `mcp.json`, and answers with what was written.
#[tauri::command]
fn mcp_save_servers(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    servers: Vec<mcp::Server>,
) -> Result<Vec<mcp::Server>, String> {
    let path = mcp::path()?;
    mcp::write_to(&path, &servers).map_err(|e| {
        log(&app, "error", format!("failed to save the servers: {e}"));
        e
    })?;
    // A connection is made from a declaration. One whose declaration has changed
    // is no longer the server the user asked for, so it is let go of here and
    // opened again — from what was just written — when it is next used.
    state.mcp.forget(&servers);
    // The chat window re-reads the tools: what the servers offer is what every
    // request after this one is sent with.
    let _ = app.emit("servers-changed", ());
    log(
        &app,
        "info",
        format!(
            "servers saved; {} declared, {} enabled",
            servers.len(),
            servers.iter().filter(|server| server.enabled).count()
        ),
    );
    Ok(servers)
}

/// Connects to one server as the settings window has it, and reports what it
/// offers: its revision, what it calls itself, and its tools.
///
/// Nothing is kept: what is being tried out is not necessarily what is saved, so
/// the connection is made from the argument and dropped at the end of the call.
#[tauri::command]
async fn mcp_test(state: State<'_, AppState>, server: mcp::Server) -> Result<mcp::Report, String> {
    state.mcp.verify(&server).await
}

/// Every enabled server's tools, and the servers that could not be reached.
///
/// The file is read rather than a copy held in memory: it is what the settings
/// window writes, and a server the user has just added should be reachable
/// without restarting the app.
///
/// `refresh` is what the composer's own **Refresh tools** presses for: a server
/// lists what it offers when it is connected to, so asking again means letting
/// the connections go and making them afresh.
#[tauri::command]
async fn mcp_tools(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    refresh: Option<bool>,
) -> Result<mcp::Tools, String> {
    let servers = mcp::read(&mcp::path()?)?;
    if refresh.unwrap_or(false) {
        let ids: Vec<String> = servers.iter().map(|server| server.id.clone()).collect();
        state.mcp.forget_ids(&ids);
    }
    let tools = state.mcp.tools(&servers).await;
    log(
        &app,
        "info",
        format!(
            "tools offered: {} from {} enabled server(s), {} unreachable",
            tools.tools.len(),
            servers.iter().filter(|server| server.enabled).count(),
            tools.failures.len()
        ),
    );
    Ok(tools)
}

/// Calls one tool, by the name the request offered it under. `args` is the
/// arguments as the JSON text the model sent.
#[tauri::command]
async fn mcp_call(state: State<'_, AppState>, name: String, args: Option<String>) -> Result<mcp::Call, String> {
    state.mcp.call(&name, args).await
}

/// The body of one completion: the chat's model and transcript, streamed, with
/// the reasoning level it is asking with and the tools it may call.
///
/// The level is always sent — `none` included — because leaving it out is a
/// different request: a model that reasons by default would go on reasoning.
fn completion(model: String, messages: Vec<Message>, reasoning: String, tools: Option<Vec<mcp::ToolOffer>>) -> Post {
    Post {
        model,
        messages,
        stream: Some(true),
        // Ask for the usage frame; without it most servers omit token counts and
        // cost from a streamed response.
        stream_options: Some(StreamOptions {
            include_usage: Some(true),
            ..StreamOptions::default()
        }),
        // The level, in the unified spelling the gateways translate for the model
        // behind them.
        reasoning: Some(ReasoningConfig {
            effort: Some(reasoning),
            ..ReasoningConfig::default()
        }),
        // A chat with no tools sends no `tools` key at all: an empty list is not
        // the same request, and some providers refuse it.
        tools: tools.map(offered).filter(|tools| !tools.is_empty()),
        ..Post::default()
    }
}

/// The servers' tools as the endpoint's own shape. Which is the same shape a
/// server's price is counted over, so the offer spells itself once, in `mcp`.
fn offered(tools: Vec<mcp::ToolOffer>) -> Vec<Tool> {
    tools.iter().map(mcp::ToolOffer::as_tool).collect()
}

/// Joins a frame's tool-call fragments into the calls they belong to.
///
/// A provider names a call once and sends its arguments in pieces, each tagged
/// with the call's index, so the fragments are gathered by index rather than
/// appended in arrival order. The name is taken from the first fragment that
/// carries one instead of being appended: it is sent once, and a provider that
/// repeated it would otherwise have it doubled.
fn absorb(calls: &mut Vec<WireCall>, fragments: &[ToolCallChunk]) {
    for fragment in fragments {
        let index = fragment.index as usize;
        if calls.len() <= index {
            calls.resize_with(index + 1, || WireCall {
                id: String::new(),
                name: String::new(),
                arguments: String::new(),
            });
        }
        let call = &mut calls[index];
        if let Some(id) = fragment.id.as_deref().filter(|id| !id.is_empty()) {
            call.id = id.to_string();
        }
        let Some(function) = &fragment.function else { continue };
        if call.name.is_empty() {
            if let Some(name) = function.name.as_deref().filter(|name| !name.is_empty()) {
                call.name = name.to_string();
            }
        }
        if let Some(arguments) = &function.arguments {
            call.arguments.push_str(arguments);
        }
    }
}

/// Ends a stream: the calls the answer asked for, when there are any, and then
/// the end of the stream itself.
///
/// Both are sent from here so that the two ways a stream ends — the provider's
/// closing frame and simply running out — leave the frontend in the same state.
/// A call with no name is one the provider never finished; there is nothing to
/// carry out, so it is dropped and said so.
fn end_stream(app: &tauri::AppHandle, on_event: &Channel<StreamEvent>, calls: &[WireCall]) {
    let named: Vec<WireCall> = calls.iter().filter(|call| !call.name.is_empty()).cloned().collect();
    if named.len() < calls.len() {
        log(app, "warn", "a tool call arrived without a name; it is not carried out");
    }
    if !named.is_empty() {
        log(app, "info", format!("{} tool call(s) asked for", named.len()));
        let _ = on_event.send(StreamEvent::ToolCalls { calls: named });
    }
    log(app, "info", "stream finished");
    let _ = on_event.send(StreamEvent::Done);
}

/// Streams a completion, reporting every outcome on `on_event`.
async fn stream_chat(app: tauri::AppHandle, config: AppConfig, model: String, reasoning: String, messages: Vec<Message>, tools: Option<Vec<mcp::ToolOffer>>, on_event: Channel<StreamEvent>) {
    let client = app.state::<AppState>().client.clone();
    let url = format!(
        "{}/chat/completions",
        settings::endpoint(&config.provider).trim_end_matches('/')
    );
    let post = completion(model, messages, reasoning, tools);

    log(
        &app,
        "info",
        format!(
            "POST {url} (model={}, messages={}, reasoning={}, tools={})",
            post.model,
            post.messages.len(),
            // Read back off the body itself, so the line names what was sent.
            post.reasoning
                .as_ref()
                .and_then(|config| config.effort.as_deref())
                .unwrap_or("off"),
            post.tools.as_ref().map_or(0, Vec::len),
        ),
    );

    let resp = match client.post(&url).bearer_auth(&config.api_key).json(&post).send().await {
        Ok(resp) => resp,
        Err(e) => {
            log(&app, "error", format!("request failed: {e}"));
            let _ = on_event.send(StreamEvent::Error { message: e.to_string() });
            return;
        }
    };

    if !resp.status().is_success() {
        let status = resp.status();
        let message = format!("HTTP {status}: {}", truncate(resp.text().await.unwrap_or_default(), 2000));
        log(&app, "error", message.clone());
        let _ = on_event.send(StreamEvent::Error { message });
        return;
    }

    // Stream SSE frames. `buffer` accumulates bytes across chunk boundaries so a
    // `data:` line split mid-chunk still parses.
    let mut stream = resp.bytes_stream();
    let mut buffer = String::new();
    // The tools this answer asks for, gathered as the fragments arrive.
    let mut calls: Vec<WireCall> = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = match chunk {
            Ok(chunk) => chunk,
            Err(e) => {
                log(&app, "error", format!("stream failed: {e}"));
                let _ = on_event.send(StreamEvent::Error { message: e.to_string() });
                return;
            }
        };
        buffer.push_str(&String::from_utf8_lossy(&chunk));
        while let Some(pos) = buffer.find('\n') {
            let line = buffer[..pos].trim_end_matches('\r').to_string();
            buffer.drain(..=pos);
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data == "[DONE]" {
                end_stream(&app, &on_event, &calls);
                return;
            }
            if data.is_empty() { continue; }
            // Ignore non-`choices` frames (usage, keep-alives, unparseable lines).
            let Ok(chunk) = serde_json::from_str::<Chunk>(data) else { continue };
            let mut closed = false;
            for choice in &chunk.choices {
                // Thinking shares the stream with the answer and normally arrives
                // first, in frames whose `content` is empty.
                let reasoning = choice.delta.reasoning_text();
                if !reasoning.is_empty() {
                    closed = on_event.send(StreamEvent::Reasoning { content: reasoning }).is_err();
                }
                if !closed {
                    if let Some(content) = choice.delta.content.as_deref().filter(|c| !c.is_empty()) {
                        closed = on_event.send(StreamEvent::Delta { content: content.to_string() }).is_err();
                    }
                }
                // A tool call rides the same stream as the answer, in fragments.
                if !closed {
                    if let Some(fragments) = &choice.delta.tool_calls {
                        absorb(&mut calls, fragments);
                    }
                }
            }
            if closed {
                log(&app, "warn", "channel closed by frontend; stopping stream");
                return; // channel closed by frontend; stop cleanly
            }
            // Usage rides on the final frame, alongside the closing choice.
            if let Some(usage) = chunk.usage {
                let _ = on_event.send(StreamEvent::Usage { usage });
            }
        }
    }
    // The provider closed the connection without its closing frame; whatever
    // arrived is still everything there is.
    end_stream(&app, &on_event, &calls);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let config = load_config(app.handle()).map_err(|e| {
                eprintln!("[error] failed to load config: {e}");
                e
            })?;
            // A history that cannot be opened must not take the chat down with it:
            // the app runs, the sidebar lists nothing, and every history command
            // says why.
            let (store, store_error) = match open_store(app.handle()) {
                Ok(store) => (Some(store), None),
                Err(e) => (None, Some(e)),
            };
            let summary = format!(
                "models=[{}] provider={} endpoint={}",
                config.models.join(", "),
                config.provider,
                settings::endpoint(&config.provider)
            );
            // The protocol client's own lines go to the same log as everything
            // else: a server that will not start says why on its stderr, and a
            // tool call that fails says why on the request's.
            let mcp = mcp::Client::new({
                let app = app.handle().clone();
                Arc::new(move |level: &str, message: String| log(&app, level, message))
            });
            app.manage(AppState {
                config: Mutex::new(config),
                client: reqwest::Client::new(),
                logger: Logger::default(),
                mcp,
                store,
                inflight: Mutex::new(None),
            });
            log(app.handle(), "info", format!("app started; {summary}"));
            match mcp::read(&mcp::path()?) {
                Ok(servers) => log(
                    app.handle(),
                    "info",
                    format!(
                        "mcp: {} server(s) declared, {} enabled",
                        servers.len(),
                        servers.iter().filter(|server| server.enabled).count()
                    ),
                ),
                // A file that cannot be read is not a reason to refuse to start:
                // the chat works without tools, and the settings window says so.
                Err(e) => log(app.handle(), "error", format!("could not read the servers: {e}")),
            }
            if let Some(e) = store_error {
                log(app.handle(), "error", format!("chat history unavailable: {e}"));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_logs,
            open_settings,
            open_logs,
            chat,
            stop_stream,
            list_chats,
            load_chat,
            save_chat,
            rename_chat,
            delete_chat,
            mcp_servers,
            mcp_save_servers,
            mcp_test,
            mcp_tools,
            mcp_call
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::chat_message::FunctionCallChunk;
    use serde_json::json;

    /// The levels the composer offers, as the wire spells them: the three a model
    /// can be asked for are forwarded, and everything else — the empty level that
    /// means off above all — asks for no reasoning, rather than leaving the model
    /// to think because nothing was said.
    #[test]
    fn a_level_is_always_asked_for_and_off_asks_for_none() {
        assert_eq!(reasoning_level(Some("low".into())), "low");
        assert_eq!(reasoning_level(Some("medium".into())), "medium");
        assert_eq!(reasoning_level(Some("high".into())), "high");
        assert_eq!(reasoning_level(Some(String::new())), "none");
        assert_eq!(reasoning_level(None), "none");
        assert_eq!(reasoning_level(Some("extreme".into())), "none");
    }

    /// The prompt belongs to the request, not to the transcript: put in front of
    /// what the window sent, ahead of the first message, and left out entirely
    /// when nothing — or only whitespace — is configured.
    #[test]
    fn the_system_prompt_goes_in_front_of_the_transcript() {
        let user: Message = serde_json::from_value(json!({ "role": "user", "content": "hi" })).unwrap();

        // On the wire: the prompt first, the transcript after it, in the shape
        // every provider accepts.
        let mut asked = vec![user.clone()];
        with_system_prompt("Be brief.", &[], &mut asked);
        let body = serde_json::to_value(completion("a/model".into(), asked, "none".into(), None)).unwrap();
        assert_eq!(
            body["messages"],
            json!([
                { "role": "system", "content": "Be brief." },
                { "role": "user", "content": "hi" },
            ])
        );

        let mut blank = vec![user.clone()];
        with_system_prompt("  \n ", &[], &mut blank);
        assert_eq!(blank, vec![user.clone()]);

        let mut none = vec![user.clone()];
        with_system_prompt("", &[], &mut none);
        assert_eq!(none, vec![user]);
    }

    /// A lazily imported server is named in the prompt rather than offered as
    /// tools: what the model is given is what it is called, what it is for and
    /// what it holds by name, and the rest is asked for with the loader. The list
    /// is a prompt of its own, so it is sent even when nothing is configured —
    /// and a server with nothing written about it, or nothing in it, is named
    /// alone rather than with empty lines under it.
    #[test]
    fn a_lazy_server_is_named_in_the_prompt() {
        let user: Message = serde_json::from_value(json!({ "role": "user", "content": "hi" })).unwrap();
        let lazy = vec![
            mcp::Lazy {
                name: "ledger".into(),
                description: "Accounts, transactions and receipts".into(),
                tools: vec!["ledger__add_account".into(), "ledger__run_query".into()],
            },
            mcp::Lazy {
                name: "notes".into(),
                description: "   ".into(),
                tools: Vec::new(),
            },
        ];

        let mut asked = vec![user.clone()];
        with_system_prompt("Be brief.", &lazy, &mut asked);
        assert_eq!(
            serde_json::to_value(&asked[0]).unwrap()["content"],
            json!(
                "Be brief.\nLazy Imported MCPs:\nledger: Accounts, transactions and receipts\n  \
                 tools: ledger__add_account, ledger__run_query\nnotes"
            )
        );

        let mut listed = vec![user];
        with_system_prompt("", &lazy, &mut listed);
        assert_eq!(
            serde_json::to_value(&listed[0]).unwrap()["content"],
            json!(
                "Lazy Imported MCPs:\nledger: Accounts, transactions and receipts\n  \
                 tools: ledger__add_account, ledger__run_query\nnotes"
            )
        );
    }

    /// A variable is resolved at the moment of the send, in the shape the prompt
    /// asks for, wherever it appears — and a name the app does not know is left
    /// alone rather than being eaten.
    #[test]
    fn a_variable_is_filled_in_at_the_moment_of_the_send() {
        use chrono::TimeZone;

        let at = FixedOffset::east_opt(0)
            .unwrap()
            .with_ymd_and_hms(2026, 10, 2, 20, 39, 2)
            .unwrap();
        assert_eq!(expand_at("It is @{{TODAY}}.", at), "It is Fri 2 Oct 2026 20:39:02.");
        assert_eq!(
            expand_at("@{{TODAY}} / @{{TODAY}}", at),
            "Fri 2 Oct 2026 20:39:02 / Fri 2 Oct 2026 20:39:02"
        );
        assert_eq!(expand_at("Nothing to fill in.", at), "Nothing to fill in.");
        assert_eq!(expand_at("@{{TOMORROW}}", at), "@{{TOMORROW}}");
    }

    /// The live path reads the machine's own clock and time zone, and writes
    /// them in the same shape: five space-separated fields, and nothing left of
    /// the token. What the fields contain is checked exactly by the test above;
    /// this one is about `Local::now()` being wired in at all.
    #[test]
    fn the_live_expansion_reads_the_machine_clock() {
        let out = expand("Sent at @{{TODAY}}.");
        let stamp = out
            .strip_prefix("Sent at ")
            .and_then(|rest| rest.strip_suffix('.'))
            .expect("the token is replaced in place");

        let fields: Vec<&str> = stamp.split(' ').collect();
        assert_eq!(fields.len(), 5, "{stamp}");
        assert!(
            ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].contains(&fields[0]),
            "{stamp}"
        );
        assert!((1..=31).contains(&fields[1].parse::<u32>().expect("a day")), "{stamp}");
        assert!(
            ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
                .contains(&fields[2]),
            "{stamp}"
        );
        assert!(fields[3].parse::<u32>().expect("a year") > 2000, "{stamp}");
        let clock: Vec<&str> = fields[4].split(':').collect();
        assert_eq!(clock.len(), 3, "{stamp}");
        assert!(clock.iter().all(|f| f.len() == 2), "{stamp}");
    }

    /// What goes out on the wire: the level nested where the gateways look for
    /// it — `reasoning.effort`, not a field of the request's own — and off sent
    /// as `none`, so a model that reasons by default is told not to.
    #[test]
    fn the_body_carries_the_level_where_the_provider_reads_it() {
        let asked = completion("a/model".into(), Vec::new(), "high".into(), None);
        let body = serde_json::to_value(&asked).unwrap();
        assert_eq!(body["reasoning"], json!({ "effort": "high" }));
        assert_eq!(body["model"], "a/model");
        assert_eq!(body["stream"], true);

        let off = serde_json::to_value(completion("a/model".into(), Vec::new(), "none".into(), None)).unwrap();
        assert_eq!(off["reasoning"], json!({ "effort": "none" }));
    }

    /// A chat with tools offers them the way the endpoint takes them — a
    /// function, its description, and its arguments' schema — and a chat without
    /// them carries no `tools` key at all, which is a different request.
    #[test]
    fn the_body_carries_the_tools_the_servers_offer() {
        let offer = mcp::ToolOffer {
            name: "ledger__accounts_list".into(),
            server: "ledger".into(),
            server_name: "Ledger".into(),
            title: "List accounts".into(),
            description: "Lists the accounts.".into(),
            parameters: json!({ "type": "object", "properties": {} }),
            auto_run: true,
        };
        let body = serde_json::to_value(completion("a/model".into(), Vec::new(), "none".into(), Some(vec![offer]))).unwrap();
        assert_eq!(
            body["tools"],
            json!([{
                "type": "function",
                "function": {
                    "name": "ledger__accounts_list",
                    "description": "Lists the accounts.",
                    "parameters": { "type": "object", "properties": {} },
                },
            }])
        );

        // A tool with nothing said about it is still offered: the name and the
        // arguments are what the model needs.
        let bare = mcp::ToolOffer {
            name: "ledger__ping".into(),
            server: "ledger".into(),
            server_name: "Ledger".into(),
            title: "Ping".into(),
            description: String::new(),
            parameters: json!({ "type": "object" }),
            auto_run: false,
        };
        let body = serde_json::to_value(completion("a/model".into(), Vec::new(), "none".into(), Some(vec![bare]))).unwrap();
        assert_eq!(body["tools"][0]["function"]["name"], "ledger__ping");
        assert!(body["tools"][0]["function"].get("description").is_none());

        // None, and an empty list, are both no tools: the key is left out rather
        // than sent empty.
        for none in [None, Some(Vec::new())] {
            let body = serde_json::to_value(completion("a/model".into(), Vec::new(), "none".into(), none)).unwrap();
            assert!(body.get("tools").is_none(), "{body}");
        }
    }

    /// A provider streams a call's arguments in pieces, and the pieces name the
    /// call they belong to. The pieces are joined into the call the request
    /// carries back, not appended one call per fragment.
    #[test]
    fn fragments_are_gathered_into_the_calls_they_belong_to() {
        let mut calls = Vec::new();
        absorb(
            &mut calls,
            &[
                ToolCallChunk {
                    index: 0,
                    id: Some("call_1".into()),
                    function: Some(FunctionCallChunk {
                        name: Some("ledger__accounts_list".into()),
                        arguments: Some("{\"ow".into()),
                    }),
                    ..ToolCallChunk::default()
                },
                ToolCallChunk {
                    index: 0,
                    function: Some(FunctionCallChunk {
                        arguments: Some("ner\":\"me\"}".into()),
                        ..FunctionCallChunk::default()
                    }),
                    ..ToolCallChunk::default()
                },
                // A second call, and a provider that repeats the name on every
                // fragment of it: the name is taken once, not glued together.
                ToolCallChunk {
                    index: 1,
                    id: Some("call_2".into()),
                    function: Some(FunctionCallChunk {
                        name: Some("ledger__ping".into()),
                        arguments: Some("{}".into()),
                    }),
                    ..ToolCallChunk::default()
                },
                ToolCallChunk {
                    index: 1,
                    function: Some(FunctionCallChunk {
                        name: Some("ledger__ping".into()),
                        arguments: None,
                    }),
                    ..ToolCallChunk::default()
                },
            ],
        );
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[0].id, "call_1");
        assert_eq!(calls[0].name, "ledger__accounts_list");
        assert_eq!(calls[0].arguments, "{\"owner\":\"me\"}");
        assert_eq!(calls[1].id, "call_2");
        assert_eq!(calls[1].name, "ledger__ping");
        assert_eq!(calls[1].arguments, "{}");
    }

    /// Opt-in, and it spends a request: asks the provider this app is configured
    /// against for a tool call, and joins the fragments exactly as
    /// [`stream_chat`] does. What a provider really sends is the one thing the
    /// hermetic tests cannot know — everything else about it is their business.
    #[test]
    #[ignore = "spends a request against the configured provider"]
    fn a_live_provider_streams_the_calls_the_reader_expects() {
        let settings = settings::load().expect("the settings file");
        let model = settings.models.first().cloned().expect("a model");
        let tools = vec![mcp::ToolOffer {
            name: "smoke__echo".into(),
            server: "smoke".into(),
            server_name: "Smoke".into(),
            title: "Echo".into(),
            description: "Echoes the text it is given.".into(),
            parameters: json!({
                "type": "object",
                "properties": { "text": { "type": "string" } },
                "required": ["text"],
            }),
            auto_run: true,
        }];
        let asked = vec![serde_json::from_value::<Message>(json!({
            "role": "user",
            "content": "Call the smoke__echo tool with the text \"hello\", then stop."
        }))
        .unwrap()];
        let post = completion(model.clone(), asked, "none".into(), Some(tools));
        let url = format!("{}/chat/completions", settings::endpoint(&settings.provider).trim_end_matches('/'));

        let body = tauri::async_runtime::block_on(async {
            let resp = reqwest::Client::new()
                .post(&url)
                .bearer_auth(&settings.api_key)
                .json(&post)
                .send()
                .await
                .expect("the request");
            assert!(resp.status().is_success(), "{}", resp.status());
            resp.text().await.expect("the body")
        });

        let mut calls: Vec<WireCall> = Vec::new();
        for line in body.lines() {
            let Some(data) = line.strip_prefix("data:") else { continue };
            let data = data.trim();
            if data.is_empty() || data == "[DONE]" {
                continue;
            }
            let Ok(chunk) = serde_json::from_str::<Chunk>(data) else { continue };
            for choice in &chunk.choices {
                if let Some(fragments) = &choice.delta.tool_calls {
                    absorb(&mut calls, fragments);
                }
            }
        }
        eprintln!("live model {model} asked for: {calls:?}");
        assert_eq!(calls.len(), 1, "{calls:?}");
        assert_eq!(calls[0].name, "smoke__echo");
        assert!(!calls[0].id.is_empty(), "{calls:?}");
        let arguments: serde_json::Value =
            serde_json::from_str(&calls[0].arguments).expect("arguments that are JSON");
        assert_eq!(arguments["text"], json!("hello"));
    }
}