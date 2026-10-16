//! The tests that were written inside `mcp.rs`.
//!
//! They are a child module of it still (`#[path]` keeps `super` pointing at the
//! same place), so they see its private items exactly as they did inline; the
//! file is separate only so that a source file is a source.

use super::*;

/// A server that stops for approval still lets a read through, because the
/// tool says so itself: that is what the protocol's hint is for.
#[test]
fn a_read_only_tool_runs_unasked_even_where_its_server_asks() {
    let mut reads = ToolAnnotations::default();
    reads.read_only_hint = Some(true);
    let mut writes = ToolAnnotations::default();
    writes.read_only_hint = Some(false);

    assert!(runs_unasked(true, None), "a server that runs its own tools");
    assert!(
        !runs_unasked(false, None),
        "and one that stops for the user"
    );
    assert!(runs_unasked(true, Some(&reads)));
    assert!(
        runs_unasked(false, Some(&reads)),
        "a read is not what the gate is for"
    );
    assert!(
        !runs_unasked(false, Some(&writes)),
        "a write is asked about"
    );
    // Saying nothing is not saying read-only.
    assert!(!runs_unasked(false, Some(&ToolAnnotations::default())));
}

fn temp(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("chalk-mcp-{name}-{}.json", std::process::id()));
    let _ = std::fs::remove_file(&path);
    path
}

fn server(id: &str, enabled: bool, auto_run: bool) -> Server {
    Server {
        id: id.into(),
        name: format!("{id} server"),
        enabled,
        auto_run,
        lazy: false,
        description: String::new(),
        transport: Transport::Http {
            url: "https://example.test/mcp".into(),
            headers: BTreeMap::from([("Authorization".to_string(), "Bearer k".to_string())]),
        },
    }
}

#[test]
fn servers_round_trip_through_a_file() {
    let path = temp("round-trip");
    let servers = vec![
        server("ledger", true, true),
        Server {
            id: "memory".into(),
            name: "Memory".into(),
            enabled: false,
            auto_run: false,
            lazy: true,
            description: "Notes kept between chats".into(),
            transport: Transport::Stdio {
                command: "npx".into(),
                args: vec!["-y".into(), "@modelcontextprotocol/server-memory".into()],
                env: BTreeMap::from([("MEMORY_FILE".to_string(), "/tmp/m.json".to_string())]),
            },
        },
    ];
    write_to(&path, &servers).unwrap();
    assert_eq!(read(&path).unwrap(), servers);
    std::fs::remove_file(&path).unwrap();
}

#[test]
fn a_file_that_is_not_there_is_no_servers() {
    let path = temp("absent");
    assert!(read(&path).unwrap().is_empty());
}

#[test]
fn an_id_may_appear_once() {
    let servers = vec![server("ledger", true, true), server("Ledger", true, false)];
    assert!(check(&servers).is_err());
    assert!(check(&[server("", true, false)]).is_err());
}

#[test]
fn what_the_file_says_about_a_server_is_what_it_is() {
    // A file written by hand, with the two transports and the defaults the
    // settings window relies on.
    let raw = r#"{
        "servers": [
            {"id": "a", "name": "A", "transport": {"type": "http", "url": "https://a.test/mcp"}},
            {"id": "b", "name": "B", "enabled": false, "autoRun": true,
             "transport": {"type": "stdio", "command": "b", "args": ["--x"]}},
            {"id": "c", "name": "C", "autoRun": false,
             "transport": {"type": "http", "url": "https://c.test/mcp"}}
        ]
    }"#;
    let file: File = serde_json::from_str(raw).unwrap();
    assert!(
        file.servers[0].enabled,
        "a server is on unless it says otherwise"
    );
    assert!(
        file.servers[0].auto_run,
        "and runs its tools unless it says otherwise"
    );
    assert!(!file.servers[1].enabled);
    assert!(file.servers[1].auto_run);
    assert!(
        !file.servers[2].auto_run,
        "and stops to ask where it says so"
    );
    assert!(matches!(
        &file.servers[1].transport,
        Transport::Stdio { command, args, .. } if command == "b" && args == &["--x"]
    ));
}

#[test]
fn a_tool_is_named_within_the_alphabet_a_function_name_allows() {
    assert_eq!(
        wire_name("ledger", "accounts.list"),
        "ledger__accounts_list"
    );
    assert_eq!(wire_name("my server", "run/thing"), "my_server__run_thing");
    let long = wire_name("server", &"t".repeat(200));
    assert_eq!(long.len(), 64);
    assert!(long.starts_with("server__"));
    // An id that would fill the name on its own is cut back, so the tool
    // keeps a character of its own and two servers still differ.
    let tight = wire_name(&"s".repeat(64), "tool");
    assert_eq!(tight.len(), 64);
    assert_eq!(tight, format!("{}__t", "s".repeat(61)));
    assert_eq!(wire_name("a", "b"), "a__b");
}

#[test]
fn a_name_taken_is_nudged() {
    let mut taken = HashMap::new();
    taken.insert("a__b".to_string(), ("a".to_string(), "b".to_string()));
    assert_eq!(unique("a__b".to_string(), &taken), "a__b_2");
    taken.insert("a__b_2".to_string(), ("a".to_string(), "b".to_string()));
    assert_eq!(unique("a__b".to_string(), &taken), "a__b_3");
}

#[test]
fn a_wire_name_still_names_its_server() {
    assert_eq!(
        split("ledger__accounts_list"),
        Some(("ledger".to_string(), "accounts_list".to_string()))
    );
    assert_eq!(split("nonsense"), None);
    assert_eq!(split("__x"), None);
}

#[test]
fn a_result_is_flattened_to_text() {
    let blocks = vec![
        ContentBlock::text("first"),
        ContentBlock::image("AAAA", "image/png"),
        ContentBlock::embedded_text("file:///a.txt", "second"),
    ];
    assert_eq!(text_of(&blocks), "first\n[image image/png]\nsecond");
}

mod probe {
    use super::*;

    #[test]
    fn the_sdk_keeps_a_tools_title() {
        let raw = r#"{"name": "echo", "title": "Echo", "description": "d", "inputSchema": {"type": "object"}}"#;
        let tool: RemoteTool = serde_json::from_str(raw).unwrap();
        eprintln!("title={:?} name={}", tool.title, tool.name);
        assert_eq!(tool.title.as_deref(), Some("Echo"));
    }
}
