//! Model context protocol: the servers `mcp.json` declares, and the client that
//! reaches them.
//!
//! A server is reached one of two ways, and both are the protocol's own. `stdio`
//! runs a program and writes one JSON-RPC message per line to its standard
//! streams; `http` posts each message to a URL — the streamable HTTP transport.
//! Which one a server is declared with is the user's business; what reaches the
//! chat is the same either way.
//!
//! Two revisions are spoken, the two the client is written for:
//! `2026-07-28`, where there is no handshake at all and every request carries its
//! own version and capabilities, and `2025-11-25`, where a session is opened with
//! an `initialize` first. The era is a property of the server, not of a request,
//! so the client probes with the newer revision and falls back to the older one:
//! a server of either era works, and the newer is used when both are on offer.
//! That probing, the framing, the version headers and the retry are the SDK's
//! (`rmcp`, the reference Rust implementation) rather than this module's — what
//! is here is the configuration, the connections, and the names the model sees.

use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;

use http::{HeaderName, HeaderValue};
use parking_lot::Mutex;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, ClientCapabilities, ClientConfig, ContentBlock,
    Implementation, ProtocolVersion, ResourceContents, ServerPeerInfo, Tool as RemoteTool,
    ToolAnnotations,
};
use rmcp::service::{ClientLifecycleMode, ClientServiceExt, RunningService};
use rmcp::transport::streamable_http_client::StreamableHttpClientTransportConfig;
use rmcp::transport::{ConfigureCommandExt, StreamableHttpClientTransport, TokioChildProcess};
use rmcp::{RoleClient, ServiceError};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::types::chat::{FunctionDef, Tool};

/// The directory the settings live in, and this file beside them.
const DIR: &str = ".chalk";
/// The file the servers are declared in.
const FILE: &str = "mcp.json";

/// What this client calls itself on every request it makes.
const CLIENT: &str = "chalk";

/// The revision that carries its version per request, and the one that opens a
/// session first. Named outright rather than taken from the SDK's `LATEST`: what
/// this app speaks, and will go on speaking, is a decision made here.
const MODERN: ProtocolVersion = ProtocolVersion::V_2026_07_28;
const LEGACY: ProtocolVersion = ProtocolVersion::V_2025_11_25;

/// The whole file. It is an object rather than a bare list so a later version of
/// the app can add a key without every file in the wild becoming invalid.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug, Default)]
#[serde(rename_all = "camelCase")]
struct File {
    #[serde(default)]
    servers: Vec<Server>,
}

/// One server, as the file holds it and the settings window edits it.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    /// The name this server's tools are named under, and what a live connection
    /// is kept by. It is the model-facing half of every tool name the server
    /// offers, so it is unique among the file's servers.
    pub id: String,
    /// What the settings window lists it as.
    #[serde(default)]
    pub name: String,
    /// A server that is off costs nothing: it is not started, its tools are not
    /// offered, and nothing is written to it.
    #[serde(default = "on")]
    pub enabled: bool,
    /// Run this server's tools as the model asks for them rather than asking
    /// first. On unless the file says otherwise, like `enabled`: a server that
    /// is declared is one the user wants reached, and a call is stopped only
    /// where they have said it should be.
    ///
    /// Off is not the whole server, though: a tool the server itself declares
    /// read-only runs as the model asks anyway — see `runs_unasked`.
    #[serde(default = "on")]
    pub auto_run: bool,
    /// A server imported lazily: its tools are not offered to a chat at all
    /// until the model asks for them by calling `load_lazy_mcp`, and until then
    /// all the model is given is its name and description in the system prompt.
    /// Off unless the file says otherwise — the file names what a chat is sent,
    /// and this key is the one that holds a server back.
    #[serde(default)]
    pub lazy: bool,
    /// What the model is told it is, while it is lazy: the description stands in
    /// for the tools, so it is the whole of what the model has to decide by.
    #[serde(default)]
    pub description: String,
    pub transport: Transport,
}

/// One lazily imported server as the system prompt names it: what it is called,
/// what it is for, and what it holds.
///
/// The tools are names rather than definitions — what a tool is called and what
/// it takes are the whole of what a request costs, and sparing the second half
/// is the point of the server being lazy — so this is everything the model knows
/// about it before it decides to ask for it.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Lazy {
    pub name: String,
    pub description: String,
    /// The names the request will spell them with — `<id>__<tool>` — since those
    /// are the names the model will be calling, and the names it is given here.
    #[serde(default)]
    pub tools: Vec<String>,
}

/// A field that is not declared is on: a server that does not say
/// `enabled: false` is enabled, and one that does not say `autoRun: false` runs
/// its tools as the model asks for them.
fn on() -> bool {
    true
}

/// How a server is reached.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Transport {
    /// A program, spoken to over its standard streams. The maps are `BTreeMap`s
    /// so the file they are written back to is in the same order every time it
    /// is saved, which is what makes it worth editing by hand.
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: BTreeMap<String, String>,
    },
    /// A URL, spoken to with the streamable HTTP transport.
    Http {
        url: String,
        #[serde(default)]
        headers: BTreeMap<String, String>,
    },
}

/// The file, under the given home directory.
pub fn path_in(home: &Path) -> PathBuf {
    home.join(DIR).join(FILE)
}

/// The file, under the current user's home directory.
pub fn path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "no home directory to keep the servers in".to_string())?;
    Ok(path_in(Path::new(&home)))
}

/// Reads the servers at `path`.
///
/// A file that is not there is no servers rather than a failure: the app is
/// usable before the user has configured anything.
pub fn read(path: &Path) -> Result<Vec<Server>, String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.to_string()),
    };
    let file: File = serde_json::from_str(&raw).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(file.servers)
}

/// Writes the servers to `path`, making its directory if it is not there.
///
/// A server's headers are where a key goes, so the file is kept the way the
/// settings file is: the directory private when it is made at all, and the file
/// closed to everyone else. A refused `chmod` is not worth failing a save over.
pub fn write_to(path: &Path, servers: &[Server]) -> Result<(), String> {
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    check(servers)?;
    let mut raw = serde_json::to_string_pretty(&File {
        servers: servers.to_vec(),
    })
    .map_err(|e| e.to_string())?;
    raw.push('\n');
    if let Some(dir) = path.parent() {
        if !dir.exists() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
    }
    std::fs::write(path, raw).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    Ok(())
}

/// What a file has to be for the app to be able to speak about its servers: an
/// id on each, shared by none, since the id is what their tools are named under.
/// Everything else can be wrong without being ambiguous, and is the user's to
/// get wrong.
fn check(servers: &[Server]) -> Result<(), String> {
    let mut seen = std::collections::HashSet::new();
    for server in servers {
        let id = server.id.trim();
        if id.is_empty() {
            return Err("every server needs an id".to_string());
        }
        if !seen.insert(id.to_lowercase()) {
            return Err(format!("{id} is the id of more than one server"));
        }
    }
    Ok(())
}

/// Where the client's own lines go: the app log. It is passed in rather than
/// reached for, so this module needs nothing of the window it runs in.
pub type Log = Arc<dyn Fn(&str, String) + Send + Sync>;

/// What one tool call answered.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Call {
    /// The result as text, which is what the model is given back. Anything that
    /// is not text — an image, an audio clip — is named rather than carried: the
    /// chat speaks text, and a server that answers with a picture in a
    /// text-only request is answered by a line saying so.
    pub text: String,
    /// True when the tool reported its own failure. It is not an error here: a
    /// tool that refuses has answered, and the model reads why.
    pub is_error: bool,
    /// The structured result, when the server sent one.
    pub structured: Option<Value>,
    /// How long the call took, in milliseconds: from asking the server to its
    /// answer, so the row that shows the call can say what it cost.
    pub ms: u64,
}

/// One tool, as the chat is offered it.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ToolOffer {
    /// The name the request offers it under, and the name the model calls it
    /// back by: the server's id and the tool's own name, joined.
    pub name: String,
    /// The id of the server offering it.
    pub server: String,
    pub server_name: String,
    /// What to list it as: the tool's title, or its name when it has none.
    pub title: String,
    pub description: String,
    /// The tool's arguments, as the JSON Schema the server gave.
    pub parameters: Value,
    /// Whether this tool runs as the model asks, or the round that calls it
    /// stops for the user first: the server's own setting, or the tool's own
    /// word that it only reads — a read is not what the gate is for.
    pub auto_run: bool,
}

impl ToolOffer {
    /// This tool as the endpoint's own shape: a function, what it does, and the
    /// JSON Schema of its arguments, which the server gave in the first place.
    pub fn as_tool(&self) -> Tool {
        Tool::Function {
            function: FunctionDef {
                name: self.name.clone(),
                // A tool with nothing to say about itself is sent without a
                // description rather than with an empty one: the two are not the
                // same request.
                description: Some(self.description.clone())
                    .filter(|description| !description.is_empty()),
                parameters: Some(self.parameters.clone()),
                strict: None,
            },
        }
    }
}

/// What tools cost a request, in bytes: the `tools` array as the endpoint
/// receives it, compact and UTF-8.
///
/// Counted here rather than in the window because this is the shape the request
/// is sent in, so a server's price is read off the very bytes it is charged for.
fn cost_of(tools: &[ToolOffer]) -> usize {
    let wire: Vec<Tool> = tools.iter().map(ToolOffer::as_tool).collect();
    serde_json::to_string(&wire).map_or(0, |json| json.len())
}

/// A server that could not be reached, and what it said.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Failure {
    pub server: String,
    pub name: String,
    pub message: String,
}

/// What one server's tools cost a request, in bytes. The settings window reads
/// a server's price from it rather than counting the tools it happens to hold.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Cost {
    pub server: String,
    pub bytes: usize,
}

/// Every enabled server's tools, the servers that did not answer, and what each
/// one's tools cost the request they are sent with.
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Tools {
    pub tools: Vec<ToolOffer>,
    pub failures: Vec<Failure>,
    pub costs: Vec<Cost>,
}

/// What a server answered when it was asked what it offers.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    /// The revision the client and server agreed on.
    pub protocol: String,
    pub server_name: String,
    pub server_version: String,
    pub tools: Vec<Line>,
}

/// One tool, for the settings window's list.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Line {
    pub name: String,
    pub title: String,
    pub description: String,
}

/// One connected server: the service, what it said about itself, and the tools
/// it offered the last time it was asked.
struct Live {
    /// The declaration this was connected from, so a save can tell which
    /// connections the edit invalidated.
    server: Server,
    service: RunningService<RoleClient, ClientConfig>,
    info: Option<ServerPeerInfo>,
    tools: Vec<RemoteTool>,
}

/// The connected servers, and the names the model is offered.
#[derive(Default)]
pub struct Client {
    log: Option<Log>,
    /// Connections, by server id, kept for the life of the window: a chat that
    /// runs several turns should pay for a server's handshake once.
    live: Mutex<HashMap<String, Arc<Live>>>,
    /// The tool names the model has been offered, and the server and tool each
    /// stands for. Rebuilt every time the tools are listed.
    index: Mutex<HashMap<String, (String, String)>>,
}

/// Whether a server's tool runs as the model asks, or stops for the user first.
///
/// The server's own setting decides it, and a tool the server itself declares
/// read-only is let through either way: that hint is what tells a read from a
/// write in the protocol, and stopping for a read is stopping for nothing. It
/// is the server's own word, taken as given — a server that lies about its own
/// tools is a server that would lie about their answers.
fn runs_unasked(auto_run: bool, annotations: Option<&ToolAnnotations>) -> bool {
    auto_run
        || annotations
            .and_then(|annotations| annotations.read_only_hint)
            .unwrap_or(false)
}

impl Client {
    pub fn new(log: Log) -> Self {
        Client {
            log: Some(log),
            ..Client::default()
        }
    }

    /// Every enabled server's tools, connecting to the ones not already held.
    ///
    /// A server that cannot be reached is not a failure of the whole: it is
    /// reported beside the tools that did arrive, so one broken server does not
    /// take the chat's other tools down with it.
    pub async fn tools(&self, servers: &[Server]) -> Tools {
        let mut tools = Vec::new();
        let mut failures = Vec::new();
        let mut costs = Vec::new();
        let mut index = HashMap::new();

        for server in servers.iter().filter(|server| server.enabled) {
            let live = match self.live(server).await {
                Ok(live) => live,
                Err(message) => {
                    self.note("error", format!("mcp[{}] {message}", server.id));
                    failures.push(Failure {
                        server: server.id.clone(),
                        name: server.name.clone(),
                        message,
                    });
                    continue;
                }
            };
            // Where this server's tools start, so the price is taken over its
            // own slice rather than the whole list each time round.
            let first = tools.len();
            for tool in &live.tools {
                let name = unique(wire_name(&server.id, &tool.name), &index);
                index.insert(name.clone(), (server.id.clone(), tool.name.to_string()));
                tools.push(ToolOffer {
                    name,
                    server: server.id.clone(),
                    server_name: server.name.clone(),
                    title: tool
                        .title
                        .clone()
                        .or_else(|| tool.annotations.as_ref().and_then(|a| a.title.clone()))
                        .unwrap_or_else(|| tool.name.to_string()),
                    description: tool.description.clone().unwrap_or_default().to_string(),
                    parameters: serde_json::to_value(&*tool.input_schema)
                        .unwrap_or_else(|_| Value::Object(Map::new())),
                    auto_run: runs_unasked(server.auto_run, tool.annotations.as_ref()),
                });
            }
            costs.push(Cost {
                server: server.id.clone(),
                bytes: cost_of(&tools[first..]),
            });
        }

        *self.index.lock() = index;
        Tools {
            tools,
            failures,
            costs,
        }
    }

    /// Calls one tool, by the name the model was offered.
    ///
    /// The name carries the server that offers it, so a call can be routed
    /// without the tools having been listed in this window's life — an approval
    /// that was left on screen, and pressed after a restart, still works.
    pub async fn call(&self, name: &str, args: Option<String>) -> Result<Call, String> {
        let arguments = match args.as_deref().map(str::trim) {
            None | Some("") => None,
            Some(raw) => Some(
                serde_json::from_str::<Map<String, Value>>(raw)
                    .map_err(|e| format!("the arguments of {name} are not an object: {e}"))?,
            ),
        };
        let (server, tool) = self
            .index
            .lock()
            .get(name)
            .cloned()
            .or_else(|| split(name))
            .ok_or_else(|| format!("{name} is not a tool of any configured server"))?;

        let live = self.live_by_id(&server).await?;
        let started = std::time::Instant::now();
        // Built rather than written out: the parameters are a struct the SDK
        // may add to, and the fields this app does not use are not the app's to
        // name.
        let mut params = CallToolRequestParams::new(tool.clone());
        params.arguments = arguments;
        let answer = live
            .service
            .call_tool_once(params)
            .await
            .map_err(|e| format!("{name}: {}", explain(&e)))?;
        let (text, is_error, structured) = match answer {
            CallToolResponse::Complete(result) => (
                text_of(&result.content),
                result.is_error.unwrap_or(false),
                result.structured_content.clone(),
            ),
            // The 2026 revision's way of asking the client for something
            // mid-call, and the tasks extension's handle: the app answers
            // neither, and says so rather than hanging on them.
            CallToolResponse::InputRequired(_) => {
                return Err(format!("{name} asked for input the app cannot give it"))
            }
            CallToolResponse::Task(_) => {
                return Err(format!("{name} answered with a task, which the app does not run"))
            }
            _ => return Err(format!("{name} answered with something the app does not understand")),
        };
        // Timed from the ask to the answer, and told to the window with it: the
        // row that shows the call says what it cost.
        let ms = started.elapsed().as_millis() as u64;
        self.note(
            "info",
            format!(
                "mcp[{server}] {name} {} in {ms}ms",
                if is_error { "failed" } else { "answered" },
            ),
        );
        Ok(Call {
            text,
            is_error,
            structured,
            ms,
        })
    }

    /// Connects to `server` without keeping it, and reports what it offers: what
    /// the settings window's Test and Verify do.
    ///
    /// The connection is not held on to — the declaration it was made from may
    /// not be saved yet, and a connection that outlived a save would be the
    /// wrong one — so this costs a handshake, which is the point of pressing it.
    pub async fn verify(&self, server: &Server) -> Result<Report, String> {
        let live = connect(server, &self.log).await?;
        let report = report(&live);
        Ok(report)
    }

    /// Drops the connections a save invalidated: the servers that changed, and
    /// the servers that are gone. The rest are left where they are, since a
    /// connection is not invalidated by an edit to another server's declaration.
    pub fn forget(&self, servers: &[Server]) {
        let mut live = self.live.lock();
        live.retain(|id, held| {
            servers
                .iter()
                .any(|server| &server.id == id && server.transport == held.server.transport)
        });
    }

    /// Drops the held connections to these servers whether or not their
    /// declarations changed.
    ///
    /// A save lets go of what it invalidated, because a connection is made from
    /// a declaration; this is the blunter question — *start this one over* — and
    /// it is what asking the tools for a second time presses for, since what a
    /// server offers is read when it is connected to.
    pub fn forget_ids(&self, ids: &[String]) {
        self.live.lock().retain(|id, _| !ids.contains(id));
    }

    /// The connection to a server, opening one if it is not already held.
    async fn live(&self, server: &Server) -> Result<Arc<Live>, String> {
        if let Some(live) = self.live.lock().get(&server.id) {
            return Ok(live.clone());
        }
        let live = Arc::new(connect(server, &self.log).await?);
        self.live.lock().insert(server.id.clone(), live.clone());
        Ok(live)
    }

    /// The connection to the server with this id, as the file declares it.
    async fn live_by_id(&self, id: &str) -> Result<Arc<Live>, String> {
        if let Some(live) = self.live.lock().get(id) {
            return Ok(live.clone());
        }
        let server = read(&path()?)?
            .into_iter()
            .find(|server| server.id == id)
            .ok_or_else(|| format!("no server is declared as {id}"))?;
        self.live(&server).await
    }

    fn note(&self, level: &str, message: String) {
        if let Some(log) = &self.log {
            log(level, message);
        }
    }
}

/// Opens a connection to `server`, and asks it what it offers.
///
/// Costing nothing until it is used is the point: nothing here runs until a chat
/// asks for tools, and an enabled server that is listed in the settings is not
/// otherwise started.
async fn connect(server: &Server, log: &Option<Log>) -> Result<Live, String> {
    let client = ClientConfig::new(
        // No capabilities of our own: the app answers no elicitation, serves no
        // sampling and has no roots to list, and a server that is told otherwise
        // would ask for them.
        ClientCapabilities::default(),
        Implementation::new(CLIENT, env!("CARGO_PKG_VERSION")),
    );
    // Probe with the modern revision, and fall back to the session handshake
    // when the server turns out to be of the earlier era.
    let lifecycle = ClientLifecycleMode::Auto {
        preferred_versions: vec![MODERN],
        legacy_version: Some(LEGACY),
    };

    let service = match &server.transport {
        Transport::Http { url, headers } => {
            let custom = headers
                .iter()
                .map(|(name, value)| header(name, value))
                .collect::<Result<_, _>>()?;
            // The transport's config is a struct the SDK may add to, so it is
            // taken as it comes and given only what this app has to say.
            let mut config = StreamableHttpClientTransportConfig::with_uri(url.as_str());
            config.custom_headers = custom;
            client
                .serve_with_lifecycle(StreamableHttpClientTransport::from_config(config), lifecycle)
                .await
        }
        Transport::Stdio { command, args, env } => {
            let cmd = tokio::process::Command::new(command).configure(|cmd| {
                cmd.args(args);
                cmd.envs(env);
            });
            let (transport, stderr) = TokioChildProcess::builder(cmd)
                .stderr(Stdio::piped())
                .spawn()
                .map_err(|e| format!("{command} could not be started: {e}"))?;
            // A server's own diagnostics go to its stderr, which is the only
            // place a server that refuses to start says why. They are read into
            // the app's log rather than dropped.
            if let (Some(stderr), Some(log)) = (stderr, log.clone()) {
                let id = server.id.clone();
                tauri::async_runtime::spawn(async move {
                    let mut lines = BufReader::new(stderr).lines();
                    while let Ok(Some(line)) = lines.next_line().await {
                        log("info", format!("mcp[{id}] {line}"));
                    }
                });
            }
            client.serve_with_lifecycle(transport, lifecycle).await
        }
    }
    .map_err(|e| format!("could not be reached: {e}"))?;

    let info = service.peer_info().map(|info| (*info).clone());
    let tools = service.list_all_tools().await.map_err(|e| explain(&e))?;
    let live = Live {
        server: server.clone(),
        service,
        info,
        tools,
    };
    if let Some(info) = &live.info {
        let version = info.protocol_version.as_str().to_string();
        if version != MODERN.as_str() && version != LEGACY.as_str() {
            // Worth a line: the app asks for two revisions, and a server that
            // answers with a third is being served by the SDK's older paths.
            if let Some(log) = log {
                log(
                    "warn",
                    format!(
                        "mcp[{}] agreed on {version}, which the app does not speak itself",
                        server.id
                    ),
                );
            }
        }
    }
    Ok(live)
}

/// What a connected server is, for the settings window.
fn report(live: &Live) -> Report {
    Report {
        protocol: live
            .info
            .as_ref()
            .map(|info| info.protocol_version.as_str().to_string())
            .unwrap_or_default(),
        server_name: live
            .info
            .as_ref()
            .and_then(|info| info.server_info.as_ref())
            .map(|info| info.name.clone())
            .unwrap_or_default(),
        server_version: live
            .info
            .as_ref()
            .and_then(|info| info.server_info.as_ref())
            .map(|info| info.version.clone())
            .unwrap_or_default(),
        tools: live
            .tools
            .iter()
            .map(|tool| Line {
                name: tool.name.to_string(),
                title: tool
                    .title
                    .clone()
                    .or_else(|| tool.annotations.as_ref().and_then(|a| a.title.clone()))
                    .unwrap_or_else(|| tool.name.to_string()),
                description: tool.description.clone().unwrap_or_default().to_string(),
            })
            .collect(),
    }
}

/// An HTTP header, as the file spells it. One the transport will not take is a
/// server that cannot be reached, so it is refused here, by name.
fn header(name: &str, value: &str) -> Result<(HeaderName, HeaderValue), String> {
    let key = HeaderName::try_from(name).map_err(|_| format!("{name} is not a header name"))?;
    let value =
        HeaderValue::try_from(value).map_err(|_| format!("{name} has a value that cannot be sent"))?;
    Ok((key, value))
}

/// The name the model is offered a tool under.
///
/// A function name takes letters, digits, `_` and `-`, up to 64 of them; a
/// protocol tool name is not held to that, and a server's id is the user's to
/// write. So both halves are brought into the alphabet, joined by a double
/// underscore, and cut to the length — the id first, so at least a character of
/// the tool survives it, since two servers offering the same tool must still
/// differ. The names are the app's own, and the server never sees them.
fn wire_name(server: &str, tool: &str) -> String {
    const LIMIT: usize = 64;
    /// The `__` between the halves, which is not the id's to spend.
    const GAP: usize = 2;
    let head: String = plain(server).chars().take(LIMIT - GAP - 1).collect();
    let room = LIMIT - head.len() - GAP;
    let body: String = plain(tool).chars().take(room).collect();
    format!("{head}__{body}")
}

/// A name in the alphabet a function name is held to.
fn plain(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// A name nothing has taken yet: two ids can come out the same once they are
/// brought into the alphabet, and a name the model calls back through cannot be
/// ambiguous, so the second is nudged rather than dropped — within the length a
/// function name has, since a name grown past it is one the provider refuses.
fn unique(name: String, taken: &HashMap<String, (String, String)>) -> String {
    if !taken.contains_key(&name) {
        return name;
    }
    (2..)
        .map(|n| {
            let suffix = format!("_{n}");
            let mut candidate: String = name.chars().take(64usize.saturating_sub(suffix.len())).collect();
            candidate.push_str(&suffix);
            candidate
        })
        .find(|candidate| !taken.contains_key(candidate))
        .unwrap_or(name)
}

/// The server and tool a wire name names, when the name still carries both.
fn split(name: &str) -> Option<(String, String)> {
    let (server, tool) = name.split_once("__")?;
    if server.is_empty() || tool.is_empty() {
        return None;
    }
    Some((server.to_string(), tool.to_string()))
}

/// A tool result's content, as text.
///
/// Only text is carried whole. Anything else is named rather than dropped: a
/// model that is told there was a picture, and what kind, can say so in its
/// answer, where a silently missing result would read as an empty one. The
/// last arm is the protocol's: content types the SDK may learn that this chat
/// has no way to show.
fn text_of(blocks: &[ContentBlock]) -> String {
    blocks
        .iter()
        .map(|block| match block {
            ContentBlock::Text(text) => text.text.clone(),
            ContentBlock::Resource(embedded) => match &embedded.resource {
                ResourceContents::TextResourceContents { text, .. } => text.clone(),
                ResourceContents::BlobResourceContents { mime_type, .. } => {
                    format!("[{} resource]", mime_type.clone().unwrap_or_else(|| "binary".into()))
                }
                _ => "[binary resource]".to_string(),
            },
            ContentBlock::ResourceLink(resource) => resource.uri.clone(),
            ContentBlock::Image(image) => format!("[image {}]", image.mime_type),
            ContentBlock::Audio(audio) => format!("[audio {}]", audio.mime_type),
            _ => "[content the app cannot read]".to_string(),
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// What to tell the user about a failed request, with the server's own code and
/// message when the failure was the protocol's rather than the transport's.
fn explain(error: &ServiceError) -> String {
    match error {
        ServiceError::McpError(data) => data.to_string(),
        other => other.to_string(),
    }
}

#[cfg(test)]
#[path = "tests/mcp.rs"]
mod tests;

