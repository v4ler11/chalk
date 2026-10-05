//! The tests that were written inside `store.rs`.
//!
//! They are a child module of it still (`#[path]` keeps `super` pointing at the
//! same place), so they see its private items exactly as they did inline; the
//! file is separate only so that a source file is a source.

use super::*;
use serde_json::json;

/// The transcript holds keys the backend's message type has never heard of —
/// the UI's timings — and provider payloads whose shape only the provider
/// defines. What goes in has to come back whole.
#[test]
fn transcript_round_trips_untouched() {
    let store = Store::in_memory().unwrap();
    let messages = json!([
        { "role": "user", "content": "hi" },
        {
            "role": "user",
            "content": [
                { "type": "text", "text": "look" },
                { "type": "image_url", "image_url": { "url": "data:image/png;base64,AAAA", "detail": "high" } }
            ]
        },
        {
            "role": "assistant",
            "content": "hello",
            "reasoning": "because",
            "reasoning_details": [{ "type": "reasoning.encrypted", "data": "signature" }],
            "tool_calls": [{ "type": "function", "id": "call_1", "function": { "name": "f", "arguments": "{}" } }],
            "waitMs": 812,
            "thinkingMs": 4103,
            "streamMs": 2201
        },
        { "role": "tool", "tool_call_id": "call_1", "name": "f", "content": "done", "ms": 412 }
    ]);

    let saved = store
        .save(
            None,
            "hi",
            "test/model",
            "high",
            None,
            &messages,
            1_700_000_000_000,
        )
        .unwrap();
    let loaded = store.load(saved.id).unwrap().unwrap();

    assert_eq!(loaded.messages, messages);
    assert_eq!(loaded.title, "hi");
    assert_eq!(loaded.id, saved.id);
    assert_eq!(loaded.reasoning, "high");
}

/// A chat's servers are the chat's own, and the two ways of offering nothing
/// are told apart: a chat that has never chosen offers every enabled server,
/// where one whose tools were switched off offers none. A column that could
/// not tell them apart would read "off" back as "never said".
#[test]
fn a_chats_servers_round_trip_and_its_silence_is_not_a_choice() {
    let store = Store::in_memory().unwrap();
    let empty = json!([]);
    let ids = vec!["ledger".to_string(), "orchard".to_string()];

    let undecided = store
        .save(None, "fresh", "test/model", "", None, &empty, 10)
        .unwrap();
    assert_eq!(store.load(undecided.id).unwrap().unwrap().servers, None);

    let chosen = store
        .save(None, "picky", "test/model", "", Some(&ids), &empty, 20)
        .unwrap();
    assert_eq!(
        store.load(chosen.id).unwrap().unwrap().servers,
        Some(ids.clone())
    );

    let quiet = store
        .save(None, "quiet", "test/model", "", Some(&[]), &empty, 30)
        .unwrap();
    assert_eq!(store.load(quiet.id).unwrap().unwrap().servers, Some(vec![]));

    // And the choice is replaced, not added to, when the chat is written again.
    store
        .save(
            Some(chosen.id),
            "picky",
            "test/model",
            "",
            Some(&[]),
            &empty,
            40,
        )
        .unwrap();
    assert_eq!(
        store.load(chosen.id).unwrap().unwrap().servers,
        Some(vec![])
    );
}

/// The frontend reads `id`, `title` and `updatedAt` off a row, the model it
/// is holding, and the reasoning level it is asking with. Renaming a field,
/// or losing the attribute that camel-cases it, would leave the sidebar
/// sorting and grouping by nothing at all.
#[test]
fn a_row_crosses_to_the_frontend_as_it_is_read() {
    let store = Store::in_memory().unwrap();
    let chat = store
        .save(None, "one", "test/model", "low", None, &json!([]), 42)
        .unwrap();

    let value = serde_json::to_value(&chat).unwrap();

    assert_eq!(
        value,
        json!({
            "id": chat.id,
            "title": "one",
            "updatedAt": 42,
            "model": "test/model",
            "reasoning": "low",
        })
    );
}

/// A database written before there were models to hold, or a reasoning level
/// to ask with: opening it has to add both columns, and the chats already in
/// it keep their transcripts with nothing against them.
#[test]
fn a_v1_database_gains_the_later_columns() {
    let path = std::env::temp_dir().join(format!("chalk-store-v1-{}.db", std::process::id()));
    let cleanup = || {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    };
    cleanup();

    {
        let conn = Connection::open(&path).unwrap();
        conn.execute_batch(V1).unwrap();
        conn.pragma_update(None, "user_version", 1).unwrap();
        conn.execute(
            "INSERT INTO chats (title, messages, updated_at) VALUES (?1, ?2, ?3)",
            params!["old chat", r#"[{"role":"user","content":"hi"}]"#, 10],
        )
        .unwrap();
    }

    let store = Store::open(&path).unwrap();
    let rows = store.list().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].title, "old chat");
    assert_eq!(rows[0].model, "");
    assert_eq!(rows[0].reasoning, "");
    let loaded = store.load(rows[0].id).unwrap().unwrap();
    assert_eq!(loaded.messages[0]["content"], "hi");
    // A chat written before the servers had a control has never chosen, so it
    // offers every enabled server rather than none of them.
    assert_eq!(loaded.servers, None);

    drop(store);
    cleanup();
}

/// The production path: a database on disk, opened, written, closed and opened
/// again — the second open has to find the schema already there rather than
/// try to create it a second time.
#[test]
fn opens_and_reopens_a_database_file() {
    let path = std::env::temp_dir().join(format!("chalk-store-{}.db", std::process::id()));
    let cleanup = || {
        for suffix in ["", "-wal", "-shm"] {
            let _ = std::fs::remove_file(format!("{}{suffix}", path.display()));
        }
    };
    cleanup();

    let store = Store::open(&path).unwrap();
    let chat = store
        .save(
            None,
            "one",
            "test/model",
            "high",
            None,
            &json!([{ "role": "user", "content": "hi" }]),
            7,
        )
        .unwrap();
    drop(store);

    let reopened = Store::open(&path).unwrap();
    let loaded = reopened.load(chat.id).unwrap().unwrap();

    assert_eq!(loaded.title, "one");
    assert_eq!(loaded.reasoning, "high");
    assert_eq!(loaded.messages[0]["content"], "hi");

    drop(reopened);
    cleanup();
}

#[test]
fn saving_an_existing_chat_replaces_it() {
    let store = Store::in_memory().unwrap();
    let first = json!([{ "role": "user", "content": "one" }]);
    let second = json!([
        { "role": "user", "content": "one" },
        { "role": "assistant", "content": "two" }
    ]);

    let chat = store
        .save(None, "one", "test/model", "low", None, &first, 10)
        .unwrap();
    store
        .save(
            Some(chat.id),
            "one",
            "test/model",
            "high",
            None,
            &second,
            20,
        )
        .unwrap();

    assert_eq!(store.list().unwrap().len(), 1);
    let loaded = store.load(chat.id).unwrap().unwrap();
    assert_eq!(loaded.messages, second);
    assert_eq!(loaded.reasoning, "high");
}

#[test]
fn listing_is_most_recently_written_first() {
    let store = Store::in_memory().unwrap();
    let empty = json!([]);
    let old = store
        .save(None, "old", "test/model", "", None, &empty, 10)
        .unwrap();
    let new = store
        .save(None, "new", "test/model", "", None, &empty, 30)
        .unwrap();
    let middle = store
        .save(None, "middle", "test/model", "", None, &empty, 20)
        .unwrap();

    let listed: Vec<i64> = store.list().unwrap().iter().map(|c| c.id).collect();
    assert_eq!(listed, vec![new.id, middle.id, old.id]);
}

#[test]
fn rename_keeps_the_transcript() {
    let store = Store::in_memory().unwrap();
    let messages = json!([{ "role": "user", "content": "keep me" }]);
    let chat = store
        .save(None, "before", "test/model", "", None, &messages, 10)
        .unwrap();

    store.rename(chat.id, "after").unwrap();

    let loaded = store.load(chat.id).unwrap().unwrap();
    assert_eq!(loaded.title, "after");
    assert_eq!(loaded.messages, messages);
    // A rename is not activity: the chat keeps its place in the list.
    assert_eq!(store.list().unwrap()[0].updated_at, 10);
}

#[test]
fn delete_removes_the_chat() {
    let store = Store::in_memory().unwrap();
    let chat = store
        .save(None, "bye", "test/model", "", None, &json!([]), 10)
        .unwrap();

    store.delete(chat.id).unwrap();

    assert!(store.load(chat.id).unwrap().is_none());
    assert!(store.list().unwrap().is_empty());
}

#[test]
fn saving_a_deleted_chat_fails() {
    let store = Store::in_memory().unwrap();
    let chat = store
        .save(None, "gone", "test/model", "", None, &json!([]), 10)
        .unwrap();
    store.delete(chat.id).unwrap();

    assert!(store
        .save(
            Some(chat.id),
            "gone",
            "test/model",
            "",
            None,
            &json!([]),
            20
        )
        .is_err());
}
