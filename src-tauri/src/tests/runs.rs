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

/// A pin is the window's own fact about a message, and it stays the window's: it
/// is written into the row the transcript is kept in — which the store carries
/// back whole, keys the wire type has never heard of and all — and a request is
/// assembled from that row by name, so none of it can reach a provider.
#[test]
fn a_pin_is_kept_in_the_row_and_never_sent() {
    let mut message = json!({ "role": "user", "content": "hi", "sentAt": 1_760_000_000_000i64 });

    set_pin(&mut message, 1_760_000_500_000).unwrap();
    assert_eq!(message["pinned"], json!(true));
    assert_eq!(message["pinnedAt"], json!(1_760_000_500_000i64));

    let sent =
        serde_json::to_value(serde_json::from_value::<Message>(message.clone()).unwrap()).unwrap();
    assert!(sent.get("pinned").is_none(), "{sent}");
    assert!(sent.get("pinnedAt").is_none(), "{sent}");
    assert_eq!(sent["content"], json!("hi"));

    // Unpinning leaves nothing behind: `pinned: false` would be a third state to
    // read where the transcript has two.
    clear_pin(&mut message);
    assert!(message.get("pinned").is_none(), "{message}");
    assert!(message.get("pinnedAt").is_none(), "{message}");
    assert_eq!(message["content"], json!("hi"));

    // A message that is not an object is not one this transcript wrote, and it is
    // refused rather than given a key it cannot hold.
    assert!(set_pin(&mut json!("hi"), 1).is_err());
}

/// Cutting a message out of a transcript cuts the results of its calls with it: a
/// call and what answered it are drawn as one row, so a transcript left holding
/// half of one would have a row about nothing in it — and the provider would be
/// sent it.
#[test]
fn cutting_a_message_takes_its_tool_results_with_it() {
    let asked = |id: &str| {
        json!({
            "role": "assistant",
            "content": "",
            "tool_calls": [{ "type": "function", "id": id, "function": { "name": "f", "arguments": "{}" } }]
        })
    };
    let answered = |id: &str| json!({ "role": "tool", "tool_call_id": id, "name": "f", "content": "done", "ms": 412 });

    let mut messages = vec![
        json!({ "role": "user", "content": "hi" }),
        asked("call_1"),
        answered("call_1"),
        json!({ "role": "assistant", "content": "there" }),
    ];
    cut_message(&mut messages, 1).unwrap();
    assert_eq!(messages.len(), 2, "{messages:?}");
    assert_eq!(messages[0]["role"], json!("user"));
    assert_eq!(messages[1]["content"], json!("there"));

    // A turn that stopped on its call: the call goes, and its answer with it.
    let mut stopped = vec![json!({ "role": "user", "content": "hi" }), asked("call_2"), answered("call_2")];
    cut_message(&mut stopped, 1).unwrap();
    assert_eq!(stopped.len(), 1, "{stopped:?}");

    // A result whose call is not in the transcript is a row of its own — a chat
    // cut short — so deleting it deletes only it.
    let mut stray = vec![json!({ "role": "user", "content": "hi" }), answered("call_9")];
    cut_message(&mut stray, 1).unwrap();
    assert_eq!(stray.len(), 1, "{stray:?}");

    // Nothing at that place is refused, rather than quietly doing nothing.
    assert!(cut_message(&mut stray, 9).is_err());
}

/// A change to one message is one write of the row, and the row is what the model
/// is sent next time: pinning writes a key the wire has never heard of, deleting
/// takes the message out with whatever answered its calls, and neither moves the
/// moment the row already had.
#[test]
fn a_messages_change_is_written_into_the_row() {
    let store = crate::store::Store::in_memory().unwrap();
    let runs = Runs::new();
    let chat = store
        .save(
            None,
            "hi",
            "test/model",
            "",
            None,
            &json!([
                { "role": "user", "content": "hi" },
                {
                    "role": "assistant",
                    "content": "",
                    "tool_calls": [{ "type": "function", "id": "call_1",
                                     "function": { "name": "f", "arguments": "{}" } }]
                },
                { "role": "tool", "tool_call_id": "call_1", "name": "f", "content": "done" },
            ]),
            10,
        )
        .unwrap();

    // Pinning: the row keeps the fact, and keeps the moment it already had — a
    // pin is not an answer, and a row that moved for one would say a thread had
    // been answered when it had only been marked.
    edit_transcript(&store, &runs, chat.id, |messages| set_pin(&mut messages[0], 99)).unwrap();
    let record = store.load(chat.id).unwrap().unwrap();
    assert_eq!(record.messages[0]["pinned"], json!(true));
    assert_eq!(record.messages[0]["pinnedAt"], json!(99));
    assert_eq!(record.messages[0]["content"], json!("hi"));
    assert_eq!(record.updated_at, 10, "the row keeps the moment it had");
    assert_eq!(store.pins().unwrap().len(), 1);

    // Unpinning takes the fact back out, and the list with it.
    edit_transcript(&store, &runs, chat.id, |messages| {
        clear_pin(&mut messages[0]);
        Ok(())
    })
    .unwrap();
    assert!(store.load(chat.id).unwrap().unwrap().messages[0]
        .get("pinned")
        .is_none());
    assert!(store.pins().unwrap().is_empty());

    // Deleting the round takes the result of its call with it, and what is left
    // is the transcript the model would be sent.
    edit_transcript(&store, &runs, chat.id, |messages| cut_message(messages, 1)).unwrap();
    let record = store.load(chat.id).unwrap().unwrap();
    assert_eq!(
        record.messages.as_array().unwrap().len(),
        1,
        "{:?}",
        record.messages
    );

    // A thread that is answering refuses the change: its run writes the whole row
    // on every commit, so a write from here would be a second writer halfway
    // through one — and nothing is written when it is refused.
    let run = Run::new(chat.id);
    run.state.lock().status = Status::Running;
    runs.put(run);
    assert!(edit_transcript(&store, &runs, chat.id, |messages| set_pin(&mut messages[0], 1)).is_err());
    assert!(store.load(chat.id).unwrap().unwrap().messages[0]
        .get("pinned")
        .is_none());
}
