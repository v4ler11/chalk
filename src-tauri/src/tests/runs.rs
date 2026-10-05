//! The parts of a run that can be read without a provider: how a thread is
//! named, what a round offers, what the prompt is told, and what a transcript
//! ending on unanswered calls comes back as.
//!
//! The loop itself is not here. It is a round trip and a stream, and testing it
//! would mean testing a mock rather than the thing; what it does is visible in
//! the app — a chat asked twice, and the log of the two requests.

use super::*;

/// A server as `mcp.json` declares one: everything the file leaves out is what
/// the file leaves out.
fn server(id: &str, name: &str, lazy: bool) -> mcp::Server {
    serde_json::from_value(json!({
        "id": id,
        "name": name,
        "command": "echo",
        "lazy": lazy,
        "description": format!("{name} things"),
        // A server is reached somehow, and the fixture reaches it the way the
        // file's own examples do: nowhere.
        "transport": { "type": "stdio", "command": "echo" },
    }))
    .unwrap()
}

/// One tool, as a server offers it.
fn tool(name: &str, server: &str) -> mcp::ToolOffer {
    serde_json::from_value(json!({
        "name": name,
        "server": server,
        "serverName": server,
        "title": name,
        "description": "",
        "parameters": { "type": "object" },
        // Whether it may run unasked belongs to the server's setting and the
        // tool's own word; the fixture says yes, which is what most do.
        "autoRun": true,
    }))
    .unwrap()
}

#[test]
fn a_thread_is_named_after_its_first_prompt() {
    assert_eq!(
        title_from(&Content::Text("  what   is\n\nthe weather ".into())),
        "what is the weather"
    );
}

#[test]
fn a_long_prompt_is_cut_to_what_a_row_holds() {
    let long = Content::Text("x".repeat(80));
    let title = title_from(&long);
    // Forty-one characters and the mark, which is what the row was written for.
    assert_eq!(title.chars().count(), 42);
    assert!(title.ends_with('…'));
}

#[test]
fn an_empty_prompt_still_names_the_thread() {
    assert_eq!(title_from(&Content::Parts(vec![])), "New thread");
}

#[test]
fn a_prompt_of_parts_is_named_after_its_words() {
    let content = Content::Parts(vec![
        Part::Text {
            text: "look at this".into(),
            cache_control: None,
        },
        Part::ImageUrl {
            image_url: crate::types::chat_message::ImageUrl {
                url: "data:image/png;base64,AAAA".into(),
                detail: None,
            },
        },
    ]);
    assert_eq!(title_from(&content), "look at this");
}

#[test]
fn a_chat_that_has_never_chosen_offers_every_enabled_server() {
    let servers = vec![server("a", "A", false), server("b", "B", false)];
    assert_eq!(offered(&servers, None), vec!["a".to_string(), "b".to_string()]);
}

#[test]
fn a_chat_that_has_chosen_offers_only_what_it_chose() {
    let servers = vec![server("a", "A", false), server("b", "B", false)];
    assert_eq!(offered(&servers, Some(&["b".to_string()])), vec!["b".to_string()]);
}

#[test]
fn a_server_switched_off_is_off_for_a_chat_that_had_it_on() {
    let mut off = server("a", "A", false);
    off.enabled = false;
    let servers = vec![off, server("b", "B", false)];
    assert_eq!(offered(&servers, Some(&["a".to_string()])), Vec::<String>::new());
}

#[test]
fn a_lazy_servers_tools_are_held_back_until_it_is_loaded() {
    let servers = vec![server("lazy", "Lazy", true), server("plain", "Plain", false)];
    let tools = vec![tool("lazy__one", "lazy"), tool("plain__two", "plain")];

    let before = offers_for(&tools, &servers, None, &[], &[]);
    let names: Vec<&str> = before.iter().map(|tool| tool.name.as_str()).collect();
    assert!(!names.contains(&"lazy__one"));
    assert!(names.contains(&"plain__two"));
    // The loader is offered while a lazy server is still waiting to be asked for.
    assert!(names.contains(&LOAD_TOOL_NAME));

    let after = offers_for(&tools, &servers, None, &["lazy".to_string()], &[]);
    let names: Vec<&str> = after.iter().map(|tool| tool.name.as_str()).collect();
    assert!(names.contains(&"lazy__one"));
    // And it stays offered once loaded: a server loaded once can be named again.
    assert!(names.contains(&LOAD_TOOL_NAME));
}

#[test]
fn a_lazy_server_nobody_can_reach_is_not_offered_at_all() {
    let servers = vec![server("lazy", "Lazy", true)];
    let tools = vec![tool("lazy__one", "lazy")];
    let sent = offers_for(&tools, &servers, None, &[], &["lazy".to_string()]);
    assert!(sent.is_empty());
    assert!(waiting(&servers, None, &["lazy".to_string()], &[]).is_empty());
}

#[test]
fn a_lazy_server_is_named_in_the_prompt_with_the_tools_it_holds() {
    let servers = vec![server("lazy", "Lazy", true)];
    let tools = vec![tool("lazy__one", "lazy"), tool("lazy__two", "lazy")];
    let prompt = lazy_prompt(&tools, &servers, None, &[]);
    assert_eq!(prompt.len(), 1);
    assert_eq!(prompt[0].name, "Lazy");
    assert_eq!(prompt[0].description, "Lazy things");
    assert_eq!(prompt[0].tools, vec!["lazy__one", "lazy__two"]);
}

#[test]
fn a_loaded_server_is_no_longer_listed_in_the_prompt() {
    let servers = vec![server("lazy", "Lazy", true)];
    let tools = vec![tool("lazy__one", "lazy")];
    assert!(lazy_prompt(&tools, &servers, None, &[]).len() == 1);
    assert!(waiting(&servers, None, &[], &["lazy".to_string()]).is_empty());
}

#[test]
fn the_loader_reads_the_name_out_of_the_arguments() {
    assert_eq!(wanted_name(r#"{"name":"ledger"}"#), "ledger");
    assert_eq!(wanted_name("not json"), "");
    assert_eq!(wanted_name(r#"{"other":1}"#), "");
}

#[test]
fn a_transcript_ending_on_calls_asks_about_them() {
    let messages = vec![
        json!({ "role": "user", "content": "hi" }),
        json!({
            "role": "assistant",
            "tool_calls": [
                { "type": "function", "id": "call_1", "function": { "name": "one", "arguments": "{}" } }
            ]
        }),
    ];
    let held = held_calls(&messages);
    assert_eq!(held.len(), 1);
    assert_eq!(held[0].name, "one");
    assert_eq!(held[0].arguments, "{}");
}

#[test]
fn a_transcript_that_ended_on_an_answer_asks_nothing() {
    let messages = vec![
        json!({ "role": "user", "content": "hi" }),
        json!({ "role": "assistant", "content": "hello" }),
        // A tool result is not the end of a turn: the answer it belongs to has
        // already been asked about.
        json!({ "role": "tool", "tool_call_id": "call_1", "name": "one", "content": "done" }),
    ];
    assert!(held_calls(&messages).is_empty());
}

#[test]
fn the_loader_offers_a_name_and_nothing_else() {
    let loader = load_tool();
    assert_eq!(loader.name, LOAD_TOOL_NAME);
    // No server offered it, and no server's row in a list should claim it.
    assert_eq!(loader.server, "");
    // It costs nothing, reaches nothing, and widens what the model may call: it
    // is run as the model asks for it.
    assert!(loader.auto_run);
    assert_eq!(loader.parameters["required"][0], "name");
}
