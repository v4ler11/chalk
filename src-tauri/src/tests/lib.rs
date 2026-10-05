//! The tests that were written inside `lib.rs`.
//!
//! They are a child module of it still (`#[path]` keeps `super` pointing at the
//! same place), so they see its private items exactly as they did inline; the
//! file is separate only so that a source file is a source.

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

/// The prompt belongs to the request, not to the transcript: resolved and
/// put in front of what the window sent, ahead of the first message. A
/// prompt of nothing is not a request with nothing to say — the note about
/// the headers every prompt carries goes in whatever it says, since the
/// header is written whether or not a prompt is.
#[test]
fn the_system_prompt_goes_in_front_of_the_transcript() {
    let user: Message = serde_json::from_value(json!({ "role": "user", "content": "hi" })).unwrap();

    // On the wire: the prompt first, the transcript after it, in the shape
    // every provider accepts.
    let mut asked = vec![user.clone()];
    with_system_prompt("Be brief.", &[], &mut asked);
    let body =
        serde_json::to_value(completion("a/model".into(), asked, "none".into(), None)).unwrap();
    assert_eq!(
        body["messages"],
        json!([
            { "role": "system", "content": format!("Be brief.\n\n{PROMPT_NOTE}") },
            { "role": "user", "content": "hi" },
        ])
    );

    // A prompt of nothing is not a request with nothing to say: the note is
    // what the model is told about the header on every prompt it reads.
    let mut blank = vec![user.clone()];
    with_system_prompt("  \n ", &[], &mut blank);
    assert_eq!(blank, vec![Message::system(PROMPT_NOTE), user.clone()]);

    let mut none = vec![user.clone()];
    with_system_prompt("", &[], &mut none);
    assert_eq!(none, vec![Message::system(PROMPT_NOTE), user]);
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
        json!(format!(
            "Be brief.\n\n{PROMPT_NOTE}\nLazy Imported MCPs:\nledger: Accounts, transactions and receipts\n  \
             tools: ledger__add_account, ledger__run_query\nnotes"
        ))
    );

    let mut listed = vec![user];
    with_system_prompt("", &lazy, &mut listed);
    assert_eq!(
        serde_json::to_value(&listed[0]).unwrap()["content"],
        json!(format!(
            "{PROMPT_NOTE}\nLazy Imported MCPs:\nledger: Accounts, transactions and receipts\n  \
             tools: ledger__add_account, ledger__run_query\nnotes"
        ))
    );
}

/// How a gap between two prompts reads: one unit while it is seconds or
/// minutes, two while it is hours or days — as much as anyone needs to know
/// how long they were away, and never a negative age when a clock goes back.
#[test]
fn a_gap_between_prompts_reads_in_two_units_at_most() {
    use chrono::Duration;

    assert_eq!(gap(Duration::seconds(0)), "0s");
    assert_eq!(gap(Duration::seconds(45)), "45s");
    assert_eq!(gap(Duration::seconds(90)), "1m");
    assert_eq!(gap(Duration::seconds(3599)), "59m");
    assert_eq!(gap(Duration::seconds(3600)), "1h 0m");
    assert_eq!(gap(Duration::seconds(3900)), "1h 5m");
    assert_eq!(gap(Duration::seconds(86_400)), "1d 0h");
    assert_eq!(gap(Duration::seconds(90_000)), "1d 1h");
    assert_eq!(gap(Duration::seconds(-5)), "0s");
}

/// What a header says: the moment the prompt was sent, then how long after
/// the one before it — or that it is the first. The moment is written in the
/// shape a prompt's `@{{TODAY}}` is, since both are the same clock read the
/// same way.
#[test]
fn a_header_names_the_moment_and_what_came_before() {
    let at = 1_760_000_000_000_i64;
    let when = |ms: i64| {
        Local
            .timestamp_millis_opt(ms)
            .unwrap()
            .format(STAMP)
            .to_string()
    };

    assert_eq!(
        header(at, None).unwrap(),
        format!("{} · the first message", when(at))
    );
    assert_eq!(
        header(at + 725_000, Some(at)).unwrap(),
        format!("{} · 12m since the previous message", when(at + 725_000))
    );
}

/// Every prompt that carries the moment it was sent is headed with it, on
/// the wire and only there: the message the user wrote stays their words —
/// which is what the store keeps and what an edit hands back — and the
/// header, not the moment, is what a request carries.
#[test]
fn the_header_is_written_over_the_prompt_on_the_way_out() {
    let at = 1_760_000_000_000_i64;
    let when = |ms: i64| {
        Local
            .timestamp_millis_opt(ms)
            .unwrap()
            .format(STAMP)
            .to_string()
    };
    let mut messages = vec![
        serde_json::from_value::<Message>(json!({ "role": "user", "content": "hi", "sentAt": at }))
            .unwrap(),
        serde_json::from_value::<Message>(json!({ "role": "assistant", "content": "hello" }))
            .unwrap(),
        serde_json::from_value::<Message>(json!({
            "role": "user",
            "content": [
                { "type": "text", "text": "look" },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,AAAA" } },
            ],
            "sentAt": at + 725_000,
        }))
        .unwrap(),
        // A prompt from a transcript written before the window kept the
        // moment: it is left as it is rather than given one it never had.
        serde_json::from_value::<Message>(json!({ "role": "user", "content": "older" })).unwrap(),
    ];
    stamp_prompts(&mut messages);

    assert_eq!(
        messages[0].content,
        Some(Content::Text(format!(
            "{} · the first message\n---\nhi",
            when(at)
        )))
    );
    assert_eq!(
        messages[1].content,
        Some(Content::Text("hello".into())),
        "only a prompt is headed"
    );
    // A prompt that carries images keeps them where they were: the header is
    // a part of its own rather than a preface to the user's own words.
    assert_eq!(
        messages[2].content,
        Some(Content::Parts(vec![
            Part::text(format!(
                "{} · 12m since the previous message\n---\n",
                when(at + 725_000)
            )),
            Part::text("look"),
            Part::ImageUrl {
                image_url: types::chat_message::ImageUrl {
                    url: "data:image/png;base64,AAAA".into(),
                    detail: None,
                }
            },
        ]))
    );
    assert_eq!(messages[3].content, Some(Content::Text("older".into())));

    // The moment is the window's own bookkeeping, and the API knows nothing
    // of it: the header is what goes out.
    let wire = serde_json::to_value(&messages[0]).unwrap();
    assert!(wire.get("sentAt").is_none(), "{wire}");
    assert!(wire.get("sent_at").is_none(), "{wire}");
}

/// The key a conversation is pinned to at the gateway is the moment its
/// first prompt was sent: the same on every request the chat makes, and no
/// other chat's.
#[test]
fn a_conversation_is_pinned_by_its_first_prompt() {
    let user = |at: Option<i64>| -> Message {
        serde_json::from_value(match at {
            Some(at) => json!({ "role": "user", "content": "hi", "sentAt": at }),
            None => json!({ "role": "user", "content": "hi" }),
        })
        .unwrap()
    };
    let assistant: Message =
        serde_json::from_value(json!({ "role": "assistant", "content": "hello" })).unwrap();

    assert_eq!(
        session_name(&[
            user(Some(1_760_000_000_000)),
            assistant.clone(),
            user(Some(1_760_000_060_000))
        ]),
        Some("chalk-1760000000000".to_owned()),
        "the first prompt names the conversation, whatever came after it"
    );
    // Nothing to pin a chat that has no moment to name it by: a transcript
    // read back from before the window kept one.
    assert_eq!(session_name(&[user(None)]), None);
    assert_eq!(session_name(&[assistant]), None);
    assert_eq!(session_name(&[]), None);
}

/// Where a reusable prefix ends is written into the request and nowhere
/// else: only for OpenRouter, which is the gateway that needs to be told,
/// and only on the last block of text — the newest prompt, or what a tool
/// answered with, with the images of a prompt left where they were.
#[test]
fn only_openrouter_is_told_where_the_prefix_ends() {
    let openrouter = AppConfig {
        provider: settings::OPENROUTER.into(),
        endpoint: String::new(),
        api_key: "sk-1".into(),
        models: vec!["a/model".into()],
        system_prompt: "Be brief.".into(),
    };
    let custom = AppConfig {
        provider: settings::CUSTOM.into(),
        endpoint: "https://example.com/v1".into(),
        ..openrouter.clone()
    };
    let asked = || {
        vec![
            serde_json::from_value::<Message>(
                json!({ "role": "user", "content": "hi", "sentAt": 1_760_000_000_000i64 }),
            )
            .unwrap(),
            serde_json::from_value::<Message>(json!({ "role": "assistant", "content": "hello" }))
                .unwrap(),
            serde_json::from_value::<Message>(
                json!({ "role": "user", "content": "and?", "sentAt": 1_760_000_060_000i64 }),
            )
            .unwrap(),
        ]
    };

    let mut marked = asked();
    assembled(&openrouter, &[], &mut marked);
    let wire = serde_json::to_value(&marked).unwrap();
    // The last prompt, as one block that ends the prefix — the header still
    // on it, since that is what the model reads.
    assert_eq!(
        wire[3]["content"][0]["cache_control"],
        json!({ "type": "ephemeral" })
    );
    assert_eq!(wire[3]["content"][0]["type"], json!("text"));
    assert!(
        wire[3]["content"][0]["text"]
            .as_str()
            .unwrap()
            .ends_with("---\nand?"),
        "{}",
        wire[3]["content"][0]["text"]
    );
    // The system message is not the block that carries it: its tail is the
    // lazily imported servers, which change under it.
    assert_eq!(
        wire[0]["content"],
        json!(format!("Be brief.\n\n{PROMPT_NOTE}"))
    );
    // Only one block is marked — the provider takes the last breakpoint, and
    // a second would say nothing more.
    assert_eq!(wire.to_string().matches("cache_control").count(), 1);

    // A gateway that is not OpenRouter is never told anything of the sort.
    let mut plain = asked();
    assembled(&custom, &[], &mut plain);
    assert!(!serde_json::to_value(&plain)
        .unwrap()
        .to_string()
        .contains("cache_control"));

    // A prompt that carries images ends its prefix with its own header —
    // the text the client wrote — rather than with the picture.
    let mut images = vec![
        serde_json::from_value::<Message>(json!({ "role": "user", "content": "hi", "sentAt": 1_760_000_000_000i64 })).unwrap(),
        serde_json::from_value::<Message>(json!({
            "role": "user",
            "content": [{ "type": "image_url", "image_url": { "url": "data:image/png;base64,AAAA" } }],
            "sentAt": 1_760_000_060_000i64,
        }))
        .unwrap(),
    ];
    assembled(&openrouter, &[], &mut images);
    let wire = serde_json::to_value(&images).unwrap();
    assert_eq!(
        wire[2]["content"][0]["cache_control"],
        json!({ "type": "ephemeral" })
    );
    assert_eq!(wire[2]["content"][1]["type"], json!("image_url"));

    // A prompt with no moment on it has no header either, so a picture alone
    // leaves nothing to end at: the mark goes on the text before it instead.
    let mut older = vec![
        serde_json::from_value::<Message>(json!({ "role": "user", "content": "hi" })).unwrap(),
        serde_json::from_value::<Message>(json!({
            "role": "user",
            "content": [{ "type": "image_url", "image_url": { "url": "data:image/png;base64,AAAA" } }],
        }))
        .unwrap(),
    ];
    assembled(&openrouter, &[], &mut older);
    let wire = serde_json::to_value(&older).unwrap();
    assert_eq!(
        wire[1]["content"][0]["cache_control"],
        json!({ "type": "ephemeral" })
    );
    assert_eq!(wire[2]["content"][0]["type"], json!("image_url"));
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
    assert_eq!(
        expand_at("It is @{{TODAY}}.", at),
        "It is Fri 2 Oct 2026 20:39:02."
    );
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
    assert!(
        (1..=31).contains(&fields[1].parse::<u32>().expect("a day")),
        "{stamp}"
    );
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

    let off = serde_json::to_value(completion(
        "a/model".into(),
        Vec::new(),
        "none".into(),
        None,
    ))
    .unwrap();
    assert_eq!(off["reasoning"], json!({ "effort": "none" }));
}

/// The response cache is OpenRouter's alone, so the header that asks for it
/// goes to OpenRouter and nowhere else: another gateway was given the URL
/// for a reason, and a header it does not know is not part of the request
/// it was written to receive.
#[test]
fn the_response_cache_is_asked_for_only_at_openrouter() {
    let sent = |provider: &str, endpoint: &str| {
        let config = AppConfig {
            provider: provider.into(),
            endpoint: endpoint.into(),
            api_key: "sk-1".into(),
            models: vec!["a/model".into()],
            system_prompt: String::new(),
        };
        with_cache(
            reqwest::Client::new().post("http://example.com/v1/chat/completions"),
            &config,
        )
        .build()
        .unwrap()
    };

    let openrouter = sent(settings::OPENROUTER, "");
    assert_eq!(
        openrouter.headers().get("x-openrouter-cache").unwrap(),
        "true"
    );
    assert_eq!(
        openrouter.url().as_str(),
        "http://example.com/v1/chat/completions",
        "the header does not move the request"
    );

    // Even pointed at OpenRouter's own endpoint, a custom provider is taken
    // at its word: what the app knows about OpenRouter hangs off its name.
    assert!(sent(settings::CUSTOM, settings::OPENROUTER_URL)
        .headers()
        .get("x-openrouter-cache")
        .is_none());
    assert!(sent(settings::CUSTOM, "http://localhost:11434/v1")
        .headers()
        .get("x-openrouter-cache")
        .is_none());
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
    let body = serde_json::to_value(completion(
        "a/model".into(),
        Vec::new(),
        "none".into(),
        Some(vec![offer]),
    ))
    .unwrap();
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
    let body = serde_json::to_value(completion(
        "a/model".into(),
        Vec::new(),
        "none".into(),
        Some(vec![bare]),
    ))
    .unwrap();
    assert_eq!(body["tools"][0]["function"]["name"], "ledger__ping");
    assert!(body["tools"][0]["function"].get("description").is_none());

    // None, and an empty list, are both no tools: the key is left out rather
    // than sent empty.
    for none in [None, Some(Vec::new())] {
        let body = serde_json::to_value(completion(
            "a/model".into(),
            Vec::new(),
            "none".into(),
            none,
        ))
        .unwrap();
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
    let url = format!(
        "{}/chat/completions",
        settings::endpoint(&settings.provider, &settings.endpoint).trim_end_matches('/')
    );

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
        let Some(data) = line.strip_prefix("data:") else {
            continue;
        };
        let data = data.trim();
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(chunk) = serde_json::from_str::<Chunk>(data) else {
            continue;
        };
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

/// Opt-in, and it spends two requests — the second is answered from the
/// provider's cache, and so is free. The app's own assembly, sent twice: the
/// first prompt of a conversation, then that conversation one prompt later.
/// The second request repeats almost everything the first carried, so almost
/// everything comes back as cached tokens — which is what makes a long
/// conversation cost a fraction of its length, and what a system prompt that
/// changes between requests takes away entirely.
///
/// The configured prompt goes out with `@{{TODAY}}` taken out of it: the
/// time of a send belongs to the prompt's own header now, and a token
/// resolving to the second would make every request a different prefix.
#[test]
#[ignore = "spends two requests against the configured provider"]
fn a_live_conversation_is_served_from_the_prompt_cache() {
    let settings = settings::load().expect("the settings file");
    let model = settings.models.first().cloned().expect("a model");
    let url = format!(
        "{}/chat/completions",
        settings::endpoint(&settings.provider, &settings.endpoint).trim_end_matches('/')
    );
    let client = reqwest::Client::new();
    let mut config = AppConfig::from(&settings);
    config.system_prompt = config.system_prompt.replace("@{{TODAY}}", "");

    let turn = |messages: &[Message]| {
        let mut asked = messages.to_vec();
        assembled(&config, &[], &mut asked);
        let mut post = completion(model.clone(), asked, "none".into(), None);
        if is_openrouter(&config) {
            post.session_id = session_name(&post.messages);
        }
        tauri::async_runtime::block_on(async {
            let resp = with_cache(client.post(&url).bearer_auth(&settings.api_key), &config)
                .json(&post)
                .send()
                .await
                .expect("the request");
            assert!(resp.status().is_success(), "{}", resp.status());
            let body = resp.text().await.expect("the body");
            let usage = body
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .filter_map(|data| serde_json::from_str::<serde_json::Value>(data.trim()).ok())
                .filter_map(|frame| frame.get("usage").cloned())
                .next_back()
                .unwrap_or_else(|| json!({}));
            (
                usage["prompt_tokens"].as_u64().unwrap_or(0),
                usage["prompt_tokens_details"]["cached_tokens"]
                    .as_u64()
                    .unwrap_or(0),
            )
        })
    };

    let start = 1_760_000_000_000_i64;
    let first = vec![serde_json::from_value::<Message>(json!({
        "role": "user", "content": "Say hello in one word.", "sentAt": start
    }))
    .unwrap()];
    let next = vec![
        first[0].clone(),
        serde_json::from_value::<Message>(json!({ "role": "assistant", "content": "Hello." }))
            .unwrap(),
        serde_json::from_value::<Message>(json!({
            "role": "user", "content": "And once more.", "sentAt": start + 60_000
        }))
        .unwrap(),
    ];

    let (prompt, cached) = turn(&first);
    eprintln!("first turn:  {cached} of {prompt} tokens cached");
    // A provider writes its cache once it has answered, so the second
    // request is not made the instant the first returns.
    std::thread::sleep(std::time::Duration::from_secs(6));
    let (prompt, cached) = turn(&next);
    eprintln!("second turn: {cached} of {prompt} tokens cached");

    assert!(
        cached * 2 > prompt,
        "the second turn of a conversation was not served from the cache: {cached} of {prompt}"
    );
}

/// Opt-in, and it spends one request: the first of the two. The second is
/// the point of it, and is free. OpenRouter's cache is OpenRouter's own, so
/// there is nothing to check it against but OpenRouter: the same request is
/// made twice, and its verdict on each — `MISS`, then `HIT` — is the whole
/// of what this asks.
#[test]
#[ignore = "spends a request against the configured provider"]
fn a_live_openrouter_answers_a_repeated_request_from_its_cache() {
    let settings = settings::load().expect("the settings file");
    // Nothing to ask a gateway that is not OpenRouter: the header is not
    // its own, and the verdict is not one it reports.
    if settings.provider.trim() != settings::OPENROUTER {
        eprintln!("the settings are not pointed at OpenRouter; nothing asked");
        return;
    }
    let config = AppConfig::from(&settings);
    let model = settings.models.first().cloned().expect("a model");
    let asked = vec![serde_json::from_value::<Message>(json!({
        "role": "user",
        "content": "Say hello in one word."
    }))
    .unwrap()];
    let post = completion(model, asked, "none".into(), None);
    let url = format!(
        "{}/chat/completions",
        settings::endpoint(&config.provider, &config.endpoint).trim_end_matches('/')
    );

    let statuses = tauri::async_runtime::block_on(async {
        let mut statuses = Vec::new();
        // One after the other: the first is what populates the cache the
        // second is answered from, and asking both at once would make them
        // two misses.
        for _ in 0..2 {
            let resp = with_cache(
                reqwest::Client::new()
                    .post(&url)
                    .bearer_auth(&settings.api_key),
                &config,
            )
            .json(&post)
            .send()
            .await
            .expect("the request");
            assert!(resp.status().is_success(), "{}", resp.status());
            statuses.push(
                resp.headers()
                    .get("x-openrouter-cache-status")
                    .and_then(|status| status.to_str().ok())
                    .map(str::to_owned),
            );
            // Read the stream to its end, so the response is finished with
            // — and cached — before the next request is made.
            let _ = resp.text().await;
        }
        statuses
    });

    eprintln!("openrouter said: {statuses:?}");
    assert_eq!(
        statuses,
        vec![Some("MISS".to_owned()), Some("HIT".to_owned())],
        "the second identical request was not answered from the cache"
    );
}
