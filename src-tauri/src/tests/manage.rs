//! The tests that were written inside `manage.rs`.
//!
//! They are a child module of it still (`#[path]` keeps `super` pointing at the
//! same place), so they see its private items exactly as they did inline; the
//! file is separate only so that a source file is a source.

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
        assert!(
            !tool.description.is_empty(),
            "{} has nothing to say",
            tool.name
        );
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
    assert!(
        bytes < 4096,
        "the app's own tools cost {bytes} bytes a request"
    );
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

    let said = model_added(
        &mut models,
        &args(json!({ "model": "c/three", "position": 1 })),
    )
    .unwrap();
    assert_eq!(models, vec!["a/one", "c/three", "b/two"]);
    assert!(said.contains("place 1"), "{said}");

    // Both halves of the answer name the list as it now stands.
    assert!(said.contains("c/three"), "{said}");

    let refused = model_added(&mut models, &args(json!({ "model": "c/three" }))).unwrap_err();
    assert!(refused.contains("already a model, at place 1"), "{refused}");
    assert_eq!(models.len(), 3);

    let refused = model_added(
        &mut models,
        &args(json!({ "model": "d/four", "position": 9 })),
    )
    .unwrap_err();
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
    assert_eq!(
        server.name, "ledger",
        "the id is the name until one is given"
    );
    assert!(server.enabled && server.auto_run && !server.lazy);
    // The answer names the header and never its value.
    assert!(said.contains("Authorization"), "{said}");
    assert!(!said.contains("sk-1"), "a value was read back out: {said}");

    let refused = server_added(
        &mut servers,
        &args(
            json!({ "id": "LEDGER", "transport": { "type": "http", "url": "https://elsewhere" } }),
        ),
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
    assert!(
        !server.enabled && server.lazy && server.auto_run,
        "autoRun was not written, so it stands"
    );
    assert_eq!(server.description, "Accounts and receipts");
    match &server.transport {
        mcp::Transport::Http { url, headers } => {
            assert_eq!(url, "https://new.example.com/mcp");
            // The header was not mentioned, so it is still there — and not
            // read back out.
            assert_eq!(
                headers.get("Authorization").map(String::as_str),
                Some("Bearer sk-1")
            );
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
    assert!(
        said.contains("ledger") && said.contains("Accounts and receipts"),
        "{said}"
    );
    assert!(said.contains("https://example.com/mcp"), "{said}");
    assert!(said.contains("Authorization"), "{said}");
    assert!(
        !said.contains("sk-secret"),
        "a header value was read out: {said}"
    );

    assert_eq!(servers_answer(&[]), "No MCP servers are declared.");
}
