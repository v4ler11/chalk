//! The app's own tools: the ones that manage the app rather than a server.
//!
//! They are offered like a server's — the same shape, the same call, the same
//! row in the transcript — but under a name of their own rather than a server's
//! id and a tool's name joined, which is what the empty `server` in their offers
//! says: the JSON view groups them under **Chalk**, beside the loader.
//!
//! They are answered here rather than by a server, against the same files the
//! settings window writes: `settings.yaml` for the models, `mcp.json` for the
//! servers. Nothing is a second copy of either — what these change, the window
//! is told about, and what the window changes, these read.

use std::collections::BTreeMap;
use std::time::Instant;

use serde_json::{json, Value};

use crate::mcp;
use crate::{apply_config, apply_servers, AppConfig, AppState};

/// Whether this call is one of the app's own, rather than a server's.
///
/// A server's tool is named `<id>__<tool>`, so a name with no id on it belongs
/// to nobody else: the list is the offers themselves, and a test keeps the two
/// from drifting apart.
pub fn owns(name: &str) -> bool {
    matches!(
        name,
        "models_list"
            | "model_add"
            | "model_remove"
            | "mcp_list"
            | "mcp_add"
            | "mcp_update"
            | "mcp_remove"
            | "mcp_test"
    )
}

/// How a server is reached, as the schema both `mcp_add` and `mcp_update` give
/// it: `http` with a url, or `stdio` with a program to run.
///
/// Written once because it is written twice otherwise — the two tools take the
/// same shape, whole or in part — and because every one of these schemas rides
/// in every request: what the tools cost is what they are sent as.
fn transport_schema(what: &str) -> Value {
    json!({
        "type": "object",
        "description": what,
        "properties": {
            "type": { "type": "string", "enum": ["http", "stdio"] },
            "url": { "type": "string" },
            "headers": { "type": "object" },
            "command": { "type": "string" },
            "args": { "type": "array", "items": { "type": "string" } },
            "env": { "type": "object" }
        },
        "required": ["type"]
    })
}

/// The app's own tools, as the window offers them.
///
/// Every one of them runs as the model asks, without stopping for the user
/// first: they are the app's own settings, and being asked for is what the chat
/// is for. What they did is in the transcript either way — the call and its
/// answer are rows of it.
pub fn tools() -> Vec<mcp::ToolOffer> {
    let offer = |name: &str, title: &str, description: &str, parameters: Value| mcp::ToolOffer {
        name: name.to_string(),
        // Not a server's, and not a chat's choice: the app's own tools are in
        // every request there is.
        server: String::new(),
        server_name: "Chalk".to_string(),
        title: title.to_string(),
        description: description.to_string(),
        parameters,
        auto_run: true,
    };
    let object = |properties: Value, required: &[&str]| {
        json!({ "type": "object", "properties": properties, "required": required })
    };

    vec![
        offer(
            "models_list",
            "List the models",
            "List the models this app offers, in the order the picker shows them — the \
             first being what a new chat starts from.",
            object(json!({}), &[]),
        ),
        offer(
            "model_add",
            "Add a model",
            "Add a model to the app's settings, so the picker and new chats offer it. \
             Writes ~/.chalk/settings.yaml.",
            object(
                json!({
                    "model": { "type": "string", "description": "The model id, as the provider spells it." },
                    "position": { "type": "integer", "description": "Where in the list, counting from 0. The end by default." }
                }),
                &["model"],
            ),
        ),
        offer(
            "model_remove",
            "Remove a model",
            "Remove a model from the app's settings by its id. The last one cannot go: a \
             chat needs a model to ask. Writes ~/.chalk/settings.yaml.",
            object(
                json!({ "model": { "type": "string", "description": "The id to remove, exactly as it is listed." } }),
                &["model"],
            ),
        ),
        offer(
            "mcp_list",
            "List the MCP servers",
            "List the model context protocol servers this app declares: what each is, \
             whether it is enabled, and how it is reached. A header or environment \
             variable is named by its key, never by its value.",
            object(json!({}), &[]),
        ),
        offer(
            "mcp_add",
            "Add an MCP server",
            "Declare a model context protocol server, so a chat can be sent its tools. \
             Writes ~/.chalk/mcp.json.",
            object(
                json!({
                    "id": { "type": "string", "description": "One word: the name its tools are named under, unique in the file." },
                    "name": { "type": "string", "description": "What the settings window lists it as. The id by default." },
                    "transport": transport_schema("How it is reached: a URL, or a program to run."),
                    "enabled": { "type": "boolean", "description": "On by default." },
                    "autoRun": { "type": "boolean", "description": "Run its tools without asking; a tool it declares read-only runs anyway. On by default." },
                    "lazy": { "type": "boolean", "description": "Hold its tools back until a chat loads them. Off by default." },
                    "description": { "type": "string", "description": "What the model is told it is, while it is lazy." }
                }),
                &["id", "transport"],
            ),
        ),
        offer(
            "mcp_update",
            "Update an MCP server",
            "Change a declared model context protocol server by its id. Only what is \
             given changes; a null in headers or env removes that entry. Writes \
             ~/.chalk/mcp.json.",
            object(
                json!({
                    "id": { "type": "string", "description": "The id of the server to change." },
                    "name": { "type": "string" },
                    "transport": transport_schema("What to change about how it is reached; the rest is left alone."),
                    "enabled": { "type": "boolean" },
                    "autoRun": { "type": "boolean" },
                    "lazy": { "type": "boolean" },
                    "description": { "type": "string" }
                }),
                &["id"],
            ),
        ),
        offer(
            "mcp_remove",
            "Remove an MCP server",
            "Remove a model context protocol server from the app's settings by its id. \
             Writes ~/.chalk/mcp.json.",
            object(
                json!({ "id": { "type": "string", "description": "The id of the server to remove." } }),
                &["id"],
            ),
        ),
        offer(
            "mcp_test",
            "Test an MCP server",
            "Connect to a declared model context protocol server and report what it \
             answered with: the revision agreed on, what it calls itself, and its tools.",
            object(
                json!({ "id": { "type": "string", "description": "The id of the server to reach." } }),
                &["id"],
            ),
        ),
    ]
}

/// Runs one of the app's own tools.
///
/// A tool that refuses has answered — a model that asked for a model that is not
/// there is told so, in so many words — so only a file that cannot be written is
/// an error here.
pub(crate) async fn call(
    app: &tauri::AppHandle,
    state: &AppState,
    name: &str,
    args: Option<&str>,
) -> Result<mcp::Call, String> {
    let started = Instant::now();
    let args = match args.map(str::trim).filter(|args| !args.is_empty()) {
        Some(args) => match serde_json::from_str::<Value>(args) {
            Ok(args) if args.is_object() => args,
            Ok(_) => Value::Object(Default::default()),
            Err(e) => {
                return Ok(answer(
                    started,
                    format!("The arguments were not JSON, so nothing was done: {e}"),
                    true,
                ))
            }
        },
        None => Value::Object(Default::default()),
    };

    let done = match name {
        "models_list" => Ok(models_answer(&state.config.lock().models)),
        "model_add" => add_model(app, state, &args),
        "model_remove" => remove_model(app, state, &args),
        "mcp_list" => Ok(servers_answer(&declared()?)),
        "mcp_add" => add_server(app, state, &args),
        "mcp_update" => update_server(app, state, &args),
        "mcp_remove" => remove_server(app, state, &args),
        "mcp_test" => test_server(state, &args).await,
        other => Err(format!("{other} is not one of the app's own tools")),
    };
    Ok(match done {
        Ok(text) => answer(started, text, false),
        Err(text) => answer(started, text, true),
    })
}

fn answer(started: Instant, text: String, is_error: bool) -> mcp::Call {
    mcp::Call {
        text,
        is_error,
        structured: None,
        ms: started.elapsed().as_millis() as u64,
    }
}

/// The servers the file declares, read fresh: it is what the settings window
/// writes, and one the user has just added should be seen without a restart.
fn declared() -> Result<Vec<mcp::Server>, String> {
    mcp::read(&mcp::path()?)
}

/// One argument, as the string it has to be.
fn wanted(args: &Value, key: &str) -> Result<String, String> {
    match args.get(key) {
        Some(Value::String(text)) if !text.trim().is_empty() => Ok(text.trim().to_string()),
        Some(Value::String(_)) => Err(format!("\"{key}\" was empty; it is what the call is about")),
        Some(_) => Err(format!("\"{key}\" was not a string")),
        None => Err(format!("\"{key}\" is required")),
    }
}

// ------------------------------------------------------------------- models

/// The models, in the order they are offered, as the model is told them.
fn models_answer(models: &[String]) -> String {
    let starts = models.first().cloned().unwrap_or_default();
    format!(
        "The models are, in the order a new chat follows them:\n{}\nA new chat starts from \"{starts}\".",
        serde_json::to_string(models).unwrap_or_else(|_| "[]".to_string())
    )
}

/// Adds one model — at the end, unless a place is given — answering with the
/// list as it now stands.
fn model_added(models: &mut Vec<String>, args: &Value) -> Result<String, String> {
    let model = wanted(args, "model")?;
    if let Some(place) = models.iter().position(|known| known == &model) {
        return Err(format!(
            "\"{model}\" is already a model, at place {place}. {}",
            models_answer(models)
        ));
    }
    let position = match args.get("position") {
        Some(Value::Number(number)) => Some(
            number
                .as_u64()
                .ok_or_else(|| "\"position\" was not a whole number".to_string())? as usize,
        ),
        Some(_) => return Err("\"position\" was not a number".to_string()),
        None => None,
    };
    let added = match position {
        Some(place) if place <= models.len() => {
            models.insert(place, model.clone());
            format!("\"{model}\" was added at place {place}.")
        }
        Some(place) => {
            return Err(format!(
                "There is no place {place}: the list holds {} model(s). {}",
                models.len(),
                models_answer(models)
            ))
        }
        None => {
            models.push(model.clone());
            format!("\"{model}\" was added at the end.")
        }
    };
    Ok(format!("{added}\n{}", models_answer(models)))
}

/// Removes one model by its id. The last one stays: a chat needs a model to ask.
///
/// Which mistake the caller made is worked out before it is answered: a model
/// that is not there is said so even when the list holds only one, since that is
/// what was asked about.
fn model_removed(models: &mut Vec<String>, args: &Value) -> Result<String, String> {
    let model = wanted(args, "model")?;
    let place = models
        .iter()
        .position(|known| known == &model)
        .ok_or_else(|| format!("\"{model}\" is not one of the models. {}", models_answer(models)))?;
    if models.len() <= 1 {
        return Err(format!(
            "\"{model}\" is the only model, and the list cannot be emptied: a chat needs \
             one to ask. Add another first."
        ));
    }
    models.remove(place);
    Ok(format!(
        "\"{model}\" was removed.\n{}",
        models_answer(models)
    ))
}

fn add_model(app: &tauri::AppHandle, state: &AppState, args: &Value) -> Result<String, String> {
    let config = state.config.lock().clone();
    let mut models = config.models.clone();
    let said = model_added(&mut models, args)?;
    apply_config(app, state, AppConfig { models, ..config })?;
    Ok(said)
}

fn remove_model(app: &tauri::AppHandle, state: &AppState, args: &Value) -> Result<String, String> {
    let config = state.config.lock().clone();
    let mut models = config.models.clone();
    let said = model_removed(&mut models, args)?;
    apply_config(app, state, AppConfig { models, ..config })?;
    Ok(said)
}

// ------------------------------------------------------------------ servers

/// One server as the model is told about it.
///
/// A header or an environment variable is named by its key and never by its
/// value: that is where a key lives, and the transcript is not the place for it.
fn server_json(server: &mcp::Server) -> Value {
    let transport = match &server.transport {
        mcp::Transport::Http { url, headers } => json!({
            "type": "http",
            "url": url,
            "headerKeys": headers.keys().collect::<Vec<_>>(),
        }),
        mcp::Transport::Stdio { command, args, env } => json!({
            "type": "stdio",
            "command": command,
            "args": args,
            "envKeys": env.keys().collect::<Vec<_>>(),
        }),
    };
    json!({
        "id": server.id,
        "name": server.name,
        "enabled": server.enabled,
        "autoRun": server.auto_run,
        "lazy": server.lazy,
        "description": server.description,
        "transport": transport,
    })
}

/// The servers, as the model is told them.
fn servers_answer(servers: &[mcp::Server]) -> String {
    if servers.is_empty() {
        return "No MCP servers are declared.".to_string();
    }
    let listed: Vec<Value> = servers.iter().map(server_json).collect();
    format!(
        "{} server(s) declared:\n{}",
        servers.len(),
        serde_json::to_string_pretty(&Value::Array(listed)).unwrap_or_else(|_| "[]".to_string())
    )
}

/// One server, from the arguments of an `mcp_add`.
fn server_from(args: &Value) -> Result<mcp::Server, String> {
    let id = wanted(args, "id")?;
    if id.contains(char::is_whitespace) {
        return Err(format!(
            "\"{id}\" has a space in it. An id is one word: it is the name this \
             server's tools are named under."
        ));
    }
    let transport = transport_from(args.get("transport").ok_or_else(|| {
        "\"transport\" is required: how the server is reached".to_string()
    })?, None)?;
    Ok(mcp::Server {
        name: args
            .get("name")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| id.clone()),
        id,
        enabled: flag(args, "enabled").unwrap_or(true),
        auto_run: flag(args, "autoRun").unwrap_or(true),
        lazy: flag(args, "lazy").unwrap_or(false),
        description: args
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        transport,
    })
}

/// A boolean argument, if it was given as one.
fn flag(args: &Value, key: &str) -> Option<bool> {
    args.get(key).and_then(Value::as_bool)
}

/// A transport, from what was written: whole, or as a change to `current`.
///
/// A change is part by part — a new `url` keeps the headers that were there, and
/// a `null` in `headers` or `env` is what removes an entry, since leaving it out
/// means leaving it alone.
fn transport_from(patch: &Value, current: Option<&mcp::Transport>) -> Result<mcp::Transport, String> {
    let kind = match patch.get("type").and_then(Value::as_str) {
        Some(kind) => kind.to_string(),
        None => match current {
            Some(mcp::Transport::Http { .. }) => "http".to_string(),
            Some(mcp::Transport::Stdio { .. }) => "stdio".to_string(),
            None => return Err("\"transport\" needs a \"type\": \"http\" or \"stdio\"".to_string()),
        },
    };
    match kind.as_str() {
        "http" => {
            let (url, headers) = match current {
                Some(mcp::Transport::Http { url, headers }) => (url.clone(), headers.clone()),
                _ => (String::new(), BTreeMap::new()),
            };
            let url = patch
                .get("url")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or(url);
            if url.trim().is_empty() {
                return Err("A server reached over http needs a \"url\".".to_string());
            }
            Ok(mcp::Transport::Http {
                url: url.trim().to_string(),
                headers: patched_map(headers, patch.get("headers"))?,
            })
        }
        "stdio" => {
            let (command, args, env) = match current {
                Some(mcp::Transport::Stdio { command, args, env }) => {
                    (command.clone(), args.clone(), env.clone())
                }
                _ => (String::new(), Vec::new(), BTreeMap::new()),
            };
            let command = patch
                .get("command")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or(command);
            if command.trim().is_empty() {
                return Err("A server that is a program needs a \"command\" to run.".to_string());
            }
            let args = match patch.get("args") {
                Some(Value::Array(args)) => args
                    .iter()
                    .map(|arg| {
                        arg.as_str()
                            .map(str::to_string)
                            .ok_or_else(|| "every one of \"args\" has to be a string".to_string())
                    })
                    .collect::<Result<Vec<String>, String>>()?,
                Some(_) => return Err("\"args\" has to be a list of strings".to_string()),
                None => args,
            };
            Ok(mcp::Transport::Stdio {
                command: command.trim().to_string(),
                args,
                env: patched_map(env, patch.get("env"))?,
            })
        }
        other => Err(format!(
            "\"{other}\" is not a transport. It is \"http\" for a URL, or \"stdio\" for a program."
        )),
    }
}

/// A map with what was written folded into it: a value replaces one, and a
/// `null` removes it.
fn patched_map(
    current: BTreeMap<String, String>,
    patch: Option<&Value>,
) -> Result<BTreeMap<String, String>, String> {
    let mut map = current;
    let Some(patch) = patch else { return Ok(map) };
    let patch = patch
        .as_object()
        .ok_or_else(|| "that has to be an object of names and values".to_string())?;
    for (key, value) in patch {
        match value {
            Value::Null => {
                map.remove(key);
            }
            Value::String(text) => {
                map.insert(key.clone(), text.clone());
            }
            _ => return Err(format!("\"{key}\" has to be a string, or null to remove it")),
        }
    }
    Ok(map)
}

/// Declares one server.
fn server_added(servers: &mut Vec<mcp::Server>, args: &Value) -> Result<String, String> {
    let server = server_from(args)?;
    if let Some(known) = servers
        .iter()
        .find(|known| known.id.eq_ignore_ascii_case(&server.id))
    {
        return Err(format!(
            "\"{}\" is already the id of a server ({}). Ids are unique.",
            server.id, known.name
        ));
    }
    servers.push(server.clone());
    Ok(format!(
        "\"{}\" was declared.\n{}",
        server.id,
        servers_answer(servers)
    ))
}

/// Changes one server by its id, leaving what was not written alone.
fn server_updated(servers: &mut [mcp::Server], args: &Value) -> Result<String, String> {
    let id = wanted(args, "id")?;
    // Named before the server is borrowed mutably: a caller that named one that
    // is not there is told what the ids are.
    let ids = server_ids(servers);
    let server = servers
        .iter_mut()
        .find(|server| server.id.eq_ignore_ascii_case(&id))
        .ok_or_else(|| format!("No server is declared as \"{id}\". {ids}"))?;

    if let Some(Value::String(name)) = args.get("name") {
        server.name = name.clone();
    }
    if let Some(Value::String(description)) = args.get("description") {
        server.description = description.clone();
    }
    if let Some(enabled) = flag(args, "enabled") {
        server.enabled = enabled;
    }
    if let Some(auto_run) = flag(args, "autoRun") {
        server.auto_run = auto_run;
    }
    if let Some(lazy) = flag(args, "lazy") {
        server.lazy = lazy;
    }
    if let Some(patch) = args.get("transport") {
        server.transport = transport_from(patch, Some(&server.transport))?;
    }
    let changed = server_json(server);
    Ok(format!(
        "\"{}\" was changed:\n{}",
        server.id,
        serde_json::to_string_pretty(&changed).unwrap_or_default()
    ))
}

/// Removes one server by its id.
fn server_removed(servers: &mut Vec<mcp::Server>, args: &Value) -> Result<String, String> {
    let id = wanted(args, "id")?;
    let place = servers
        .iter()
        .position(|server| server.id.eq_ignore_ascii_case(&id))
        .ok_or_else(|| format!("No server is declared as \"{id}\". {}", server_ids(servers)))?;
    let removed = servers.remove(place);
    Ok(format!(
        "\"{}\" was removed. A chat that had chosen it is no longer offered its tools, \
         since nothing declares them.\n{}",
        removed.id,
        servers_answer(servers)
    ))
}

/// What the servers are called, for a caller that named one that is not there.
fn server_ids(servers: &[mcp::Server]) -> String {
    if servers.is_empty() {
        return "None are declared.".to_string();
    }
    format!(
        "The declared ones are: {}.",
        servers
            .iter()
            .map(|server| server.id.as_str())
            .collect::<Vec<_>>()
            .join(", ")
    )
}

fn add_server(app: &tauri::AppHandle, state: &AppState, args: &Value) -> Result<String, String> {
    let mut servers = declared()?;
    let said = server_added(&mut servers, args)?;
    apply_servers(app, state, servers)?;
    Ok(said)
}

fn update_server(app: &tauri::AppHandle, state: &AppState, args: &Value) -> Result<String, String> {
    let mut servers = declared()?;
    let said = server_updated(&mut servers, args)?;
    apply_servers(app, state, servers)?;
    Ok(said)
}

fn remove_server(app: &tauri::AppHandle, state: &AppState, args: &Value) -> Result<String, String> {
    let mut servers = declared()?;
    let said = server_removed(&mut servers, args)?;
    apply_servers(app, state, servers)?;
    Ok(said)
}

/// Reaches one server and reports what it answered with — the settings window's
/// own **Test**, so a server that has just been declared can be checked.
async fn test_server(state: &AppState, args: &Value) -> Result<String, String> {
    let id = wanted(args, "id")?;
    let servers = declared()?;
    let server = servers
        .iter()
        .find(|server| server.id.eq_ignore_ascii_case(&id))
        .ok_or_else(|| format!("No server is declared as \"{id}\". {}", server_ids(&servers)))?;
    let report = state.mcp.verify(server).await?;
    Ok(format!(
        "\"{id}\" answered:\n{}",
        serde_json::to_string_pretty(&report).unwrap_or_default()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(value: Value) -> Value {
        value
    }

    /// The names a call is recognised by and the names that are offered are one
    /// list: a tool the model is given has to be one this module answers.
    #[test]
    fn every_offered_tool_is_one_that_owns_its_name() {
        let tools = tools();
        assert_eq!(tools.len(), 8);
        for tool in &tools {
            assert!(owns(&tool.name), "{} is offered but not owned", tool.name);
            assert!(tool.auto_run, "{} would stop the turn", tool.name);
            assert!(tool.server.is_empty(), "{} claims a server", tool.name);
            assert!(!tool.description.is_empty(), "{} has nothing to say", tool.name);
            assert_eq!(tool.parameters["type"], json!("object"), "{}", tool.name);
        }
        assert!(!owns("ledger__list_accounts"));
        assert!(!owns("load_lazy_mcp"));
        assert!(!owns("models_lists"));

        // They ride in every request there is, so what they cost is worth a
        // bound: past it, holding them back would be a decision to take again.
        let wire: Vec<crate::types::chat::Tool> = tools.iter().map(mcp::ToolOffer::as_tool).collect();
        let bytes = serde_json::to_string(&wire).map_or(0, |json| json.len());
        eprintln!("the app's own tools cost {bytes} bytes a request");
        assert!(bytes < 4096, "the app's own tools cost {bytes} bytes a request");
    }

    /// A model is added where it was asked for, or at the end — and one that is
    /// already there is said so rather than added twice, since the list is what
    /// the picker shows and what a new chat starts from.
    #[test]
    fn a_model_is_added_once_and_where_it_was_asked_for() {
        let mut models = vec!["a/one".to_string()];

        let said = model_added(&mut models, &args(json!({ "model": "b/two" }))).unwrap();
        assert_eq!(models, vec!["a/one", "b/two"]);
        assert!(said.contains("at the end"), "{said}");

        let said = model_added(&mut models, &args(json!({ "model": "c/three", "position": 1 }))).unwrap();
        assert_eq!(models, vec!["a/one", "c/three", "b/two"]);
        assert!(said.contains("place 1"), "{said}");

        // Both halves of the answer name the list as it now stands.
        assert!(said.contains("c/three"), "{said}");

        let refused = model_added(&mut models, &args(json!({ "model": "c/three" }))).unwrap_err();
        assert!(refused.contains("already a model, at place 1"), "{refused}");
        assert_eq!(models.len(), 3);

        let refused = model_added(&mut models, &args(json!({ "model": "d/four", "position": 9 }))).unwrap_err();
        assert!(refused.contains("no place 9"), "{refused}");
        assert_eq!(models.len(), 3);

        let refused = model_added(&mut models, &args(json!({ "model": "   " }))).unwrap_err();
        assert!(refused.contains("empty"), "{refused}");
    }

    /// The last model stays: the settings window cannot empty the list either,
    /// and a chat with no model has nothing to ask.
    #[test]
    fn the_last_model_is_not_removed() {
        let mut models = vec!["a/one".to_string()];
        let refused = model_removed(&mut models, &args(json!({ "model": "a/one" }))).unwrap_err();
        assert!(refused.contains("only model"), "{refused}");
        assert_eq!(models, vec!["a/one"]);

        let mut models = vec!["a/one".to_string(), "b/two".to_string()];
        let said = model_removed(&mut models, &args(json!({ "model": "a/one" }))).unwrap();
        assert_eq!(models, vec!["b/two"]);
        assert!(said.contains("was removed"), "{said}");

        let refused = model_removed(&mut models, &args(json!({ "model": "a/one" }))).unwrap_err();
        assert!(refused.contains("is not one of the models"), "{refused}");
        assert!(refused.contains("b/two"), "{refused}");
    }

    /// A server is declared whole, with the defaults the file's own keys have,
    /// and one id is one server: a second declaration of it is refused rather
    /// than shadowing the first.
    #[test]
    fn a_server_is_declared_whole_and_its_id_is_its_own() {
        let mut servers = Vec::new();
        let said = server_added(
            &mut servers,
            &args(json!({
                "id": "ledger",
                "transport": { "type": "http", "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer sk-1" } }
            })),
        )
        .unwrap();
        assert!(said.contains("was declared"), "{said}");
        let server = &servers[0];
        assert_eq!(server.name, "ledger", "the id is the name until one is given");
        assert!(server.enabled && server.auto_run && !server.lazy);
        // The answer names the header and never its value.
        assert!(said.contains("Authorization"), "{said}");
        assert!(!said.contains("sk-1"), "a value was read back out: {said}");

        let refused = server_added(
            &mut servers,
            &args(json!({ "id": "LEDGER", "transport": { "type": "http", "url": "https://elsewhere" } })),
        )
        .unwrap_err();
        assert!(refused.contains("already the id"), "{refused}");
        assert_eq!(servers.len(), 1);

        let refused = server_added(
            &mut servers,
            &args(json!({ "id": "two words", "transport": { "type": "http", "url": "https://x" } })),
        )
        .unwrap_err();
        assert!(refused.contains("one word"), "{refused}");

        // A server has to be reachable by something.
        let refused = server_added(
            &mut servers,
            &args(json!({ "id": "quiet", "transport": { "type": "http" } })),
        )
        .unwrap_err();
        assert!(refused.contains("needs a \"url\""), "{refused}");
        let refused = server_added(
            &mut servers,
            &args(json!({ "id": "quiet", "transport": { "type": "stdio" } })),
        )
        .unwrap_err();
        assert!(refused.contains("needs a \"command\""), "{refused}");
        let refused = server_added(&mut servers, &args(json!({ "id": "quiet" }))).unwrap_err();
        assert!(refused.contains("\"transport\" is required"), "{refused}");
        assert_eq!(servers.len(), 1);
    }

    /// A change touches what it names and nothing else: a new url keeps the
    /// headers, a flag turns over on its own, and a null is how a header goes.
    #[test]
    fn a_server_is_changed_part_by_part() {
        let mut servers = vec![mcp::Server {
            id: "ledger".into(),
            name: "Ledger".into(),
            enabled: true,
            auto_run: true,
            lazy: false,
            description: String::new(),
            transport: mcp::Transport::Http {
                url: "https://old.example.com/mcp".into(),
                headers: [("Authorization".to_string(), "Bearer sk-1".to_string())]
                    .into_iter()
                    .collect(),
            },
        }];

        let said = server_updated(
            &mut servers,
            &args(json!({
                "id": "ledger",
                "name": "The ledger",
                "enabled": false,
                "lazy": true,
                "description": "Accounts and receipts",
                "transport": { "url": "https://new.example.com/mcp" }
            })),
        )
        .unwrap();
        let server = &servers[0];
        assert_eq!(server.name, "The ledger");
        assert!(!server.enabled && server.lazy && server.auto_run, "autoRun was not written, so it stands");
        assert_eq!(server.description, "Accounts and receipts");
        match &server.transport {
            mcp::Transport::Http { url, headers } => {
                assert_eq!(url, "https://new.example.com/mcp");
                // The header was not mentioned, so it is still there — and not
                // read back out.
                assert_eq!(headers.get("Authorization").map(String::as_str), Some("Bearer sk-1"));
            }
            other => panic!("{other:?}"),
        }
        assert!(!said.contains("sk-1"), "a value was read back out: {said}");

        // A null removes an entry, and the transport can be replaced outright.
        server_updated(
            &mut servers,
            &args(json!({
                "id": "ledger",
                "transport": { "type": "stdio", "command": "ledger-mcp", "args": ["--stdio"] }
            })),
        )
        .unwrap();
        assert_eq!(
            servers[0].transport,
            mcp::Transport::Stdio {
                command: "ledger-mcp".into(),
                args: vec!["--stdio".into()],
                env: BTreeMap::new(),
            }
        );

        let refused = server_updated(&mut servers, &args(json!({ "id": "notes" }))).unwrap_err();
        assert!(refused.contains("No server is declared"), "{refused}");
        assert!(refused.contains("ledger"), "{refused}");
    }

    /// Removing one says what it was and what is left, and a caller that names
    /// one that is not there is told what is.
    #[test]
    fn a_server_is_removed_by_its_id() {
        let mut servers = vec![
            mcp::Server {
                id: "ledger".into(),
                name: "Ledger".into(),
                enabled: true,
                auto_run: true,
                lazy: false,
                description: String::new(),
                transport: mcp::Transport::Http {
                    url: "https://example.com/mcp".into(),
                    headers: BTreeMap::new(),
                },
            },
            mcp::Server {
                id: "notes".into(),
                name: "Notes".into(),
                enabled: true,
                auto_run: true,
                lazy: false,
                description: String::new(),
                transport: mcp::Transport::Stdio {
                    command: "notes-mcp".into(),
                    args: Vec::new(),
                    env: BTreeMap::new(),
                },
            },
        ];

        let said = server_removed(&mut servers, &args(json!({ "id": "LEDGER" }))).unwrap();
        assert!(said.contains("was removed"), "{said}");
        assert!(said.contains("notes"), "{said}");
        assert_eq!(servers.len(), 1);

        let refused = server_removed(&mut servers, &args(json!({ "id": "ledger" }))).unwrap_err();
        assert!(refused.contains("No server is declared"), "{refused}");

        let said = server_removed(&mut servers, &args(json!({ "id": "notes" }))).unwrap();
        assert!(said.contains("No MCP servers are declared"), "{said}");
    }

    /// What the model is told about the servers: what each is and how it is
    /// reached — and a bearer token is not part of it.
    #[test]
    fn the_servers_are_listed_without_their_secrets() {
        let servers = vec![mcp::Server {
            id: "ledger".into(),
            name: "Ledger".into(),
            enabled: true,
            auto_run: false,
            lazy: true,
            description: "Accounts and receipts".into(),
            transport: mcp::Transport::Http {
                url: "https://example.com/mcp".into(),
                headers: [("Authorization".to_string(), "Bearer sk-secret".to_string())]
                    .into_iter()
                    .collect(),
            },
        }];
        let said = servers_answer(&servers);
        assert!(said.contains("ledger") && said.contains("Accounts and receipts"), "{said}");
        assert!(said.contains("https://example.com/mcp"), "{said}");
        assert!(said.contains("Authorization"), "{said}");
        assert!(!said.contains("sk-secret"), "a header value was read out: {said}");

        assert_eq!(servers_answer(&[]), "No MCP servers are declared.");
    }
}
