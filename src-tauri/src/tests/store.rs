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
/// is holding, and the reasoning level it is asking with. The channel reads
/// three more: when the thread was posted, the prompt it was posted as, and how
/// much has come back since — and a fourth, how many pictures that prompt
/// carried, which is what tells its row whether there are any to draw. The
/// sidebar's list reads one more: when the thread was pinned, which is both what
/// puts it in that list and what marks its row.
/// Renaming a field, or losing the attribute that camel-cases it, would leave
/// the feed drawing threads with nothing to draw.
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
            // The row above holds no transcript, which is the one case where a
            // thread has neither a prompt of its own nor anything after it.
            "createdAt": 42,
            "root": "",
            "replies": 0,
            // Nothing has been said at all, so nothing has been said by the
            // user either — and the prompt is not a thing said in a thread.
            "mine": 0,
            "images": 0,
            // A thread nobody has pinned says so with a zero rather than with an
            // absent field: the list is drawn from the same rows the feed is, and
            // a key that came and went would be a second shape to read.
            "pinnedAt": 0,
        })
    );
}

/// A thread answered again keeps the place it was posted in: a feed orders by
/// when a thread was made, not by what happened to it last, so an answer
/// arriving in the background cannot shuffle the channel under the reader.
#[test]
fn a_thread_keeps_its_place_when_it_is_answered_again() {
    let store = Store::in_memory().unwrap();
    let first = store
        .save(None, "first", "m", "", None, &json!([]), 10)
        .unwrap();
    let second = store
        .save(None, "second", "m", "", None, &json!([]), 20)
        .unwrap();

    assert_eq!(store.list().unwrap()[0].id, second.id);

    // The older one is written again, later. It is still the older one.
    store
        .save(
            Some(first.id),
            "first",
            "m",
            "",
            None,
            &json!([{ "role": "user", "content": "hello" }]),
            30,
        )
        .unwrap();

    let rows = store.list().unwrap();
    assert_eq!(rows[0].id, second.id);
    assert_eq!(rows[1].id, first.id);
    // And what the row says about itself follows its transcript, not its order.
    assert_eq!(rows[1].created_at, 10);
    assert_eq!(rows[1].updated_at, 30);
}

/// A thread is drawn by the prompt it was posted as, and says how much has come
/// back since. The words of a prompt with a picture in it are the words, and a
/// count read off the transcript cannot drift from it.
#[test]
fn a_thread_is_named_by_its_prompt_and_counts_what_follows() {
    let store = Store::in_memory().unwrap();
    let chat = store
        .save(
            None,
            "what is this",
            "m",
            "",
            None,
            &json!([
                { "role": "user", "content": [
                    { "type": "text", "text": "what is this" },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,AA" } },
                ] },
                { "role": "assistant", "content": "a picture" },
            ]),
            42,
        )
        .unwrap();

    assert_eq!(chat.root, "what is this");
    assert_eq!(chat.replies, 1);
    // And the list, which reads the same row through a different query, agrees.
    let listed = &store.list().unwrap()[0];
    assert_eq!(listed.root, "what is this");
    assert_eq!(listed.replies, 1);
}

/// A turn that calls tools writes more than one message, and most of them are
/// not things said: a tool's result is what came back from a call, and a round
/// that called one without writing a word is a step between two messages of its
/// own. A thread answered through a call has said one thing — the answer — and
/// not the four messages it took to get there.
#[test]
fn a_turns_tools_are_not_replies() {
    let store = Store::in_memory().unwrap();
    let chat = store
        .save(
            None,
            "what did I spend",
            "m",
            "",
            None,
            &json!([
                { "role": "user", "content": "what did I spend" },
                { "role": "assistant", "content": "", "tool_calls": [
                    { "id": "call_1", "type": "function", "function": { "name": "one", "arguments": "{}" } },
                ] },
                { "role": "tool", "tool_call_id": "call_1", "name": "one", "content": "12" },
                { "role": "assistant", "content": "a euro" },
            ]),
            42,
        )
        .unwrap();

    assert_eq!(chat.replies, 1);
    assert_eq!(store.list().unwrap()[0].replies, 1);
}

/// An answer that used a tool is an answer: a round with words of its own counts
/// whether or not it also called something, which is the one difference between
/// it and a round that only called.
#[test]
fn an_answer_that_called_a_tool_still_counts() {
    let store = Store::in_memory().unwrap();
    let chat = store
        .save(
            None,
            "what did I spend",
            "m",
            "",
            None,
            &json!([
                { "role": "user", "content": "what did I spend" },
                { "role": "assistant", "content": "Let me look.", "tool_calls": [
                    { "id": "call_1", "type": "function", "function": { "name": "one", "arguments": "{}" } },
                ] },
                { "role": "tool", "tool_call_id": "call_1", "name": "one", "content": "12" },
                { "role": "assistant", "content": "A euro." },
            ]),
            42,
        )
        .unwrap();

    assert_eq!(chat.replies, 2);
    assert_eq!(store.list().unwrap()[0].replies, 2);
}

/// The pictures a prompt was posted with: the row says how many there are, so a
/// row of the feed knows whether it has any to draw, and the pictures themselves
/// are read by id — an attachment is a data URL, and the list is read on every
/// post.
#[test]
fn a_threads_pictures_are_counted_in_the_list_and_read_by_id() {
    let store = Store::in_memory().unwrap();
    let chat = store
        .save(
            None,
            "look",
            "m",
            "",
            None,
            &json!([
                { "role": "user", "content": [
                    { "type": "text", "text": "look" },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,AA" } },
                    { "type": "image_url", "image_url": { "url": "data:image/png;base64,BB" } },
                ] },
                { "role": "assistant", "content": "seen" },
            ]),
            42,
        )
        .unwrap();

    assert_eq!(chat.images, 2);
    assert_eq!(store.list().unwrap()[0].images, 2);
    assert_eq!(
        store.root_images(chat.id).unwrap(),
        vec!["data:image/png;base64,AA", "data:image/png;base64,BB"]
    );
}

/// A prompt of words alone carries no picture, and a chat that is gone carries
/// nothing: asking is answered with none rather than with a failure.
#[test]
fn a_prompt_of_words_alone_has_no_pictures_to_read() {
    let store = Store::in_memory().unwrap();
    let chat = store
        .save(
            None,
            "hello",
            "m",
            "",
            None,
            &json!([{ "role": "user", "content": "hello" }]),
            42,
        )
        .unwrap();

    assert_eq!(chat.images, 0);
    assert!(store.root_images(chat.id).unwrap().is_empty());
    assert!(store.root_images(chat.id + 1).unwrap().is_empty());
}

/// A person is a participant in their own thread once they have said something
/// in it. The prompt that opened it is the thread rather than a reply to it, so
/// it is not counted among their own replies — and a thread they have only
/// opened is one the assistant alone has answered.
#[test]
fn the_opening_prompt_is_not_one_of_the_users_replies() {
    let store = Store::in_memory().unwrap();
    let asked = store
        .save(
            None,
            "what accounts do I have?",
            "m",
            "",
            None,
            &json!([
                { "role": "user", "content": "what accounts do I have?" },
                { "role": "assistant", "content": "three" },
            ]),
            42,
        )
        .unwrap();
    let followed = store
        .save(
            None,
            "and the balances?",
            "m",
            "",
            None,
            &json!([
                { "role": "user", "content": "what accounts do I have?" },
                { "role": "assistant", "content": "three" },
                { "role": "user", "content": "and the balances?" },
                { "role": "assistant", "content": "here" },
            ]),
            43,
        )
        .unwrap();

    assert_eq!(asked.replies, 1);
    assert_eq!(asked.mine, 0);
    assert_eq!(followed.replies, 3);
    assert_eq!(followed.mine, 1);
    // And the list, which derives both in its own query, agrees with both.
    let rows = store.list().unwrap();
    let listed = |title: &str| rows.iter().find(|row| row.title == title).unwrap();
    assert_eq!(listed("what accounts do I have?").mine, 0);
    assert_eq!(listed("and the balances?").mine, 1);
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
    // And one written before there were pins is not pinned: the column arrives
    // with a zero in it rather than with nothing to read.
    assert_eq!(rows[0].pinned_at, 0);

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

/// A pin is a mark on a thread's own row rather than a row of its own, so the
/// pins list is a list of chats with one more thing in it: what comes back is
/// what any other list would draw about the thread, ordered by when it was
/// pinned, and a thread that is not pinned is not in it at all.
#[test]
fn pinned_threads_are_listed_most_recently_pinned_first() {
    let store = Store::in_memory().unwrap();
    let older = store
        .save(
            None,
            "first",
            "test/model",
            "",
            None,
            &json!([{ "role": "user", "content": "what we pinned" }]),
            10,
        )
        .unwrap();
    let newer = store
        .save(
            None,
            "second",
            "test/model",
            "",
            None,
            &json!([
                { "role": "user", "content": "the other one" },
                { "role": "assistant", "content": "an answer" },
            ]),
            20,
        )
        .unwrap();
    // A thread nobody pinned: the query is what decides, so it is not in the list.
    store
        .save(None, "third", "test/model", "", None, &json!([]), 30)
        .unwrap();

    assert!(store.pins().unwrap().is_empty(), "nothing is pinned yet");

    store.set_pinned(newer.id, 200).unwrap();
    store.set_pinned(older.id, 100).unwrap();

    let pins = store.pins().unwrap();
    assert_eq!(pins.len(), 2);
    // Most recently pinned first, whichever thread was written when.
    assert_eq!(pins[0].id, newer.id);
    assert_eq!(pins[0].pinned_at, 200);
    assert_eq!(pins[0].root, "the other one");
    assert_eq!(pins[0].replies, 1, "the list says what any list says");
    assert_eq!(pins[1].id, older.id);
    assert_eq!(pins[1].pinned_at, 100);
    assert_eq!(pins[1].root, "what we pinned");

    // Unpinning takes it out, and leaves the rest of the row alone: what the feed
    // says about a thread is about its messages, and a pin is not one.
    let before = store.list().unwrap();
    let written = before.iter().find(|chat| chat.id == newer.id).unwrap();
    assert_eq!(written.updated_at, 20, "the row's own moment does not move");
    store.set_pinned(newer.id, 0).unwrap();
    let pins = store.pins().unwrap();
    assert_eq!(pins.len(), 1);
    assert_eq!(pins[0].id, older.id);
    let after = store.list().unwrap();
    let written = after.iter().find(|chat| chat.id == newer.id).unwrap();
    assert_eq!(written.updated_at, 20);
    assert_eq!(written.replies, 1, "and neither does anything else about it");

    // A row that is gone cannot be pinned: an update that hits nothing must not
    // report success.
    store.delete(older.id).unwrap();
    assert!(store.set_pinned(older.id, 5).is_err());
}
