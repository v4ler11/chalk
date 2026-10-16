//! The parts of a run that can be read without a provider: how a thread is named,
//! what a round offers, what the prompt is told, what a committed response leaves
//! in the transcript, which reads keep a run and which let it go, and what a
//! transcript ending on unanswered calls comes back as.
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

/// A response in flight, before the model has said anything: no words, no
/// reasoning and no calls, which is where a round that has been asked sits until
/// something arrives.
fn in_flight(started_at: i64) -> Partial {
    Partial {
        answer: String::new(),
        reasoning: String::new(),
        started_at,
        first_token_at: None,
        thinking: true,
        thinking_ms: None,
        usage: None,
    }
}

/// One call, as the model asked for it.
fn call(id: &str, name: &str) -> WireCall {
    WireCall {
        id: id.to_string(),
        name: name.to_string(),
        arguments: "{}".to_string(),
    }
}

/// The app's state as far as a chat being read is concerned: the history a run is
/// made from and the runs there are. Nothing here reaches a provider or a server,
/// which is why a state can be one at all.
fn app_state() -> AppState {
    AppState {
        config: Mutex::new(
            serde_json::from_value(json!({
                "name": "test",
                "provider": "test",
                "endpoint": "http://localhost",
                "apiKey": "",
                "models": [],
                "defaultModel": "test/model",
                "systemPrompt": "",
                "gateways": [],
            }))
            .unwrap(),
        ),
        client: reqwest::Client::new(),
        logger: crate::logging::Logger::default(),
        mcp: mcp::Client::default(),
        store: Some(crate::store::Store::in_memory().unwrap()),
        runs: Runs::new(),
    }
}

/// A row as a chat that answered once, with whatever last message is given after
/// the prompt.
fn row(state: &AppState, last: Value) -> i64 {
    state
        .store
        .as_ref()
        .unwrap()
        .save(
            None,
            "hi",
            "test/model",
            "",
            None,
            &json!([{ "role": "user", "content": "hi" }, last]),
            1,
        )
        .unwrap()
        .id
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
    let prompt = lazy_prompt(&tools, &servers, None, &[], &[]);
    assert_eq!(prompt.len(), 1);
    assert_eq!(prompt[0].name, "Lazy");
    assert_eq!(prompt[0].description, "Lazy things");
    assert_eq!(prompt[0].tools, vec!["lazy__one", "lazy__two"]);
}

/// A server this run has loaded is no longer named in the prompt: it was named
/// while it was waiting, and the turn goes on with its tools offered and the
/// prompt no longer spending the lines on what the model has already got.
#[test]
fn a_loaded_server_is_no_longer_listed_in_the_prompt() {
    let servers = vec![server("lazy", "Lazy", true)];
    let tools = vec![tool("lazy__one", "lazy")];
    let loaded = vec!["lazy".to_string()];

    assert_eq!(lazy_prompt(&tools, &servers, None, &[], &[]).len(), 1);
    assert!(lazy_prompt(&tools, &servers, None, &loaded, &[]).is_empty());
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

/// A reply is something said: the user's words and the answers the model gave,
/// counted together, with what the tools answered and the rounds that only
/// called them left out — which is the same count the store derives in the query
/// a list is drawn from.
#[test]
fn a_reply_is_something_said() {
    let messages = json!([
        { "role": "user", "content": "one" },
        { "role": "assistant", "content": "", "tool_calls": [] },
        { "role": "tool", "tool_call_id": "call_1", "content": "done" },
        { "role": "assistant", "content": "two" },
    ]);
    assert_eq!(spoken(messages.as_array().unwrap()), 2);
    // And none of them are the user's own: they wrote once, which opened the
    // thread rather than answering it.
    assert_eq!(mine(messages.as_array().unwrap()), 0);
}

/// A chat is set to things through its row, and a chat with a run is read
/// through the run: a level written to the row alone would be answered with what
/// the run still held, which is a control that moves and springs back.
#[test]
fn a_run_answers_with_what_the_chat_was_set_to() {
    let run = Run::new(1);
    run.adopt(crate::store::ChatRecord {
        id: 1,
        updated_at: 1_700_000_000_000,
        title: "one".into(),
        model: "old/model".into(),
        reasoning: "low".into(),
        servers: Some(vec!["a".to_string()]),
        messages: json!([{ "role": "user", "content": "hello" }]),
    });

    run.retune("new/model".into(), "high".into(), Some(vec!["b".to_string()]));

    let snapshot = run.snapshot();
    assert_eq!(snapshot.model, "new/model");
    assert_eq!(snapshot.reasoning, "high");
    assert_eq!(snapshot.servers, Some(vec!["b".to_string()]));
    // What it was holding is untouched: the change is to what the chat is sent
    // with, not to what has been said.
    assert_eq!(snapshot.messages.len(), 1);
}

/// A stop during the model's silent wait leaves nothing behind: the response has
/// no words, no reasoning and no calls in it, and a committed assistant message
/// holding an empty content is one every later request would carry.
#[test]
fn a_stop_before_the_first_token_leaves_no_message() {
    assert!(as_message(&in_flight(1_000), &[], 4_000).is_none());
}

/// The other side of that: a round that only asked for tools is committed for
/// them, with no content of its own, because the request that follows carries the
/// message and the calls in it — and a call no message holds is a transcript the
/// provider refuses.
#[test]
fn a_round_that_only_asked_for_tools_is_committed_for_them() {
    let message = as_message(&in_flight(1_000), &[call("call_1", "one")], 4_000).unwrap();
    assert_eq!(message["role"], "assistant");
    assert!(message.get("content").is_none());
    assert_eq!(message["tool_calls"][0]["id"], "call_1");
    assert_eq!(message["tool_calls"][0]["function"]["name"], "one");
}

/// An answer keeps the moment it began speaking, absolute: a head is timed from
/// it, and the wait alone cannot work it back, since a round that queued for a
/// place among the requests began later than the prompt was posted.
#[test]
fn a_committed_answer_carries_the_moment_it_began_speaking() {
    let mut partial = in_flight(1_000);
    partial.answer = "hello".into();
    partial.first_token_at = Some(1_400);
    partial.thinking = false;
    partial.thinking_ms = Some(0);

    let message = as_message(&partial, &[], 2_000).unwrap();
    assert_eq!(message["content"], "hello");
    assert_eq!(message["waitMs"], 400);
    assert_eq!(message["firstTokenAt"], 1_400);
}

/// Every call in a round is answered — a call whose own task did not come back
/// among them. The request that follows carries the calls and the messages
/// answering them, so one answered as some other call, or not at all, is a
/// request the provider refuses.
#[test]
fn every_call_in_a_round_is_answered() {
    let answer = could_not_run(&call("call_7", "read_file"), "the task was cancelled", 4);
    assert_eq!(answer["role"], "tool");
    assert_eq!(answer["tool_call_id"], "call_7");
    assert_eq!(answer["name"], "read_file");
    assert_eq!(
        answer["content"],
        "The tool could not be run: the task was cancelled"
    );
    assert_eq!(answer["ms"], 4);
}

/// A chat's choice of servers can be cleared, and clearing it is not the same as
/// leaving it alone: the window leaves the key out for one and sends a `null` for
/// the other, and only the value it sent tells the two apart.
#[test]
fn a_chats_choice_of_servers_can_be_cleared() {
    let held = Some(vec!["a".to_string()]);
    assert_eq!(chosen_servers(None, held.clone()).unwrap(), held);
    assert_eq!(chosen_servers(Some(&json!(null)), held.clone()).unwrap(), None);
    assert_eq!(
        chosen_servers(Some(&json!(["b", "c"])), held.clone()).unwrap(),
        Some(vec!["b".to_string(), "c".to_string()])
    );
    // Anything that is neither is refused rather than read as one of the three.
    assert!(chosen_servers(Some(&json!("b")), held).is_err());
}

/// A turn that is over takes its run with it: what it did is in its row by now, so
/// the map holds the turns that have something to answer for rather than a
/// transcript per chat ever opened, the prompt images riding it among them, for as
/// long as the process runs.
#[test]
fn a_finished_run_is_gone_from_the_map() {
    let runs = Runs::new();
    let run = Run::new(1);
    runs.put(run.clone());
    assert!(runs.get(1).is_some());

    run.end_turn(&runs);

    assert!(runs.get(1).is_none());
    // And it ended the way a finished turn ends: idle, with nothing waiting on
    // the user.
    assert_eq!(run.snapshot().status, Status::Idle);
}

/// A chat that is only read keeps no run: it is made from its row, read, and let
/// go, so a window opening threads does not hold one transcript per thread for the
/// life of the process.
#[test]
fn a_chat_that_is_only_read_keeps_no_run() {
    let state = app_state();
    let chat = row(&state, json!({ "role": "assistant", "content": "hello" }));

    let read = ensure(&state, chat).unwrap().unwrap();
    assert_eq!(read.snapshot().messages.len(), 2);
    assert!(state.runs.get(chat).is_none());
}

/// A chat whose row ends on calls nobody answered is the one a read keeps: the
/// calls are the run's to hold, since allowing or declining them is a command that
/// has to find it.
#[test]
fn a_chat_with_calls_nobody_answered_keeps_its_run() {
    let state = app_state();
    let chat = row(
        &state,
        json!({
            "role": "assistant",
            "tool_calls": [
                { "type": "function", "id": "call_1", "function": { "name": "one", "arguments": "{}" } }
            ]
        }),
    );

    let read = ensure(&state, chat).unwrap().unwrap();
    assert_eq!(read.snapshot().awaiting.len(), 1);
    assert!(state.runs.get(chat).is_some());
}
