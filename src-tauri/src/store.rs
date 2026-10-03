//! Chat history on SQLite.
//!
//! One row per chat, holding the whole transcript as JSON. The transcript is
//! written and read back as an opaque [`serde_json::Value`] on purpose: it is the
//! frontend's `UiMessage` array, which carries provider-shaped fields the backend's
//! own `Message` knows nothing about — notably the UI's three timing keys, and
//! reasoning details whose signatures have to survive a replay. Deserialising it
//! into `Message` would quietly drop them, so it never passes through that type.

use std::path::Path;

use parking_lot::Mutex;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use serde_json::Value;

/// The schema, at `user_version` 1.
///
/// `id` orders chats by creation as well as naming them, so no `created_at` is
/// kept; `updated_at` is what the list sorts and groups by.
const V1: &str = "
CREATE TABLE chats (
    id         INTEGER PRIMARY KEY,
    title      TEXT    NOT NULL,
    updated_at INTEGER NOT NULL,
    messages   TEXT    NOT NULL
);
CREATE INDEX chats_updated ON chats(updated_at DESC, id DESC);
";

/// The schema, at `user_version` 2: the model a chat is holding. It belongs to
/// the chat rather than to the settings, so a conversation keeps the model it
/// was had with — and the most recent row is what a new chat starts from.
const V2: &str = "ALTER TABLE chats ADD COLUMN model TEXT NOT NULL DEFAULT '';";

/// The schema, at `user_version` 3: how hard the chat asks the model to think.
/// Like the model, it belongs to the chat, so a conversation picked up again is
/// asked the same way — and an empty level, which is every row written before
/// there was a control for it, is not asked at all.
const V3: &str = "ALTER TABLE chats ADD COLUMN reasoning TEXT NOT NULL DEFAULT '';";

/// The schema, at `user_version` 4: the model context protocol servers this
/// chat offers.
///
/// Which of them a conversation is sent with belongs to the conversation, like
/// its model and its level, so switching a server off for one chat does not
/// switch it off for the rest. The column holds their ids as JSON, and the two
/// ways of having nothing to say are told apart: `[]` is a chat that offers no
/// server — the control switched everything off — where an empty string is a
/// chat that has never chosen, which is every row written before there was a
/// control for it, and offers every enabled server. A column that could not tell
/// those apart would turn "tools off for this chat" into "tools on again" the
/// next time it was read.
const V4: &str = "ALTER TABLE chats ADD COLUMN servers TEXT NOT NULL DEFAULT '';";

/// One row of the history list: what a list shows, without the transcript.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: i64,
    pub title: String,
    /// Unix time in milliseconds of the chat's last write.
    pub updated_at: i64,
    /// The model this chat is holding; empty on a row written before there was
    /// more than one model to hold.
    pub model: String,
    /// The reasoning level this chat is asking with; empty is off, which is
    /// every row written before there was a control for it.
    pub reasoning: String,
}

/// A chat and its transcript.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatRecord {
    pub id: i64,
    pub title: String,
    pub model: String,
    pub reasoning: String,
    /// The ids of the servers this chat offers, or `None` while it has never
    /// chosen — which offers every enabled server.
    pub servers: Option<Vec<String>>,
    /// The transcript exactly as it was written.
    pub messages: Value,
}

pub struct Store {
    conn: Mutex<Connection>,
}

impl Store {
    /// Opens the database at `path`, creating and migrating it as needed.
    pub fn open(path: &Path) -> Result<Self, String> {
        Self::prepare(Connection::open(path).map_err(err)?)
    }

    /// A fresh database in memory, for tests.
    #[cfg(test)]
    pub fn in_memory() -> Result<Self, String> {
        Self::prepare(Connection::open_in_memory().map_err(err)?)
    }

    fn prepare(conn: Connection) -> Result<Self, String> {
        // WAL keeps a write from blocking a read — the list and the open chat are
        // read while a message is being saved — and survives a crash mid-write.
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous = NORMAL;
             PRAGMA foreign_keys = ON;",
        )
        .map_err(err)?;
        let store = Self {
            conn: Mutex::new(conn),
        };
        store.migrate()?;
        Ok(store)
    }

    /// Brings the schema up to the latest version, one step at a time.
    fn migrate(&self) -> Result<(), String> {
        let conn = self.conn.lock();
        let version: i64 = conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))
            .map_err(err)?;
        if version < 1 {
            conn.execute_batch(V1).map_err(err)?;
            conn.pragma_update(None, "user_version", 1).map_err(err)?;
        }
        if version < 2 {
            conn.execute_batch(V2).map_err(err)?;
            conn.pragma_update(None, "user_version", 2).map_err(err)?;
        }
        if version < 3 {
            conn.execute_batch(V3).map_err(err)?;
            conn.pragma_update(None, "user_version", 3).map_err(err)?;
        }
        if version < 4 {
            conn.execute_batch(V4).map_err(err)?;
            conn.pragma_update(None, "user_version", 4).map_err(err)?;
        }
        Ok(())
    }

    /// The chats, most recently written first.
    pub fn list(&self) -> Result<Vec<ChatSummary>, String> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare(
                "SELECT id, title, updated_at, model, reasoning FROM chats ORDER BY updated_at DESC, id DESC",
            )
            .map_err(err)?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ChatSummary {
                    id: row.get(0)?,
                    title: row.get(1)?,
                    updated_at: row.get(2)?,
                    model: row.get(3)?,
                    reasoning: row.get(4)?,
                })
            })
            .map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    }

    /// One chat with its transcript, or `None` if the row is gone.
    pub fn load(&self, id: i64) -> Result<Option<ChatRecord>, String> {
        let conn = self.conn.lock();
        let row = conn
            .query_row(
                "SELECT id, title, model, reasoning, servers, messages FROM chats WHERE id = ?1",
                [id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                    ))
                },
            )
            .optional()
            .map_err(err)?;

        row.map(|(id, title, model, reasoning, servers, raw)| {
            let messages =
                serde_json::from_str(&raw).map_err(|e| format!("chat {id} holds unreadable JSON: {e}"))?;
            // A chat that has never chosen holds an empty string, which is not
            // the same as one that offers nothing: the choice is only a choice
            // once something has been switched.
            let servers = match servers.as_str() {
                "" => None,
                json => Some(
                    serde_json::from_str(json)
                        .map_err(|e| format!("chat {id} holds unreadable server ids: {e}"))?,
                ),
            };
            Ok(ChatRecord {
                id,
                title,
                model,
                reasoning,
                servers,
                messages,
            })
        })
        .transpose()
    }

    /// Writes a chat and returns its row: creates it when `id` is `None`, and
    /// otherwise replaces that chat's title, model, reasoning level, servers and
    /// transcript.
    pub fn save(
        &self,
        id: Option<i64>,
        title: &str,
        model: &str,
        reasoning: &str,
        servers: Option<&[String]>,
        messages: &Value,
        now: i64,
    ) -> Result<ChatSummary, String> {
        let raw = serde_json::to_string(messages).map_err(|e| e.to_string())?;
        // No choice at all is written as no text, which is what a row written
        // before the column existed holds.
        let ids = match servers {
            None => String::new(),
            Some(ids) => serde_json::to_string(ids).map_err(|e| e.to_string())?,
        };
        let conn = self.conn.lock();
        let id = match id {
            Some(id) => {
                let changed = conn
                    .execute(
                        "UPDATE chats SET title = ?2, model = ?3, reasoning = ?4, servers = ?5, messages = ?6, updated_at = ?7 WHERE id = ?1",
                        params![id, title, model, reasoning, ids, raw, now],
                    )
                    .map_err(err)?;
                // The row was deleted in another window, or by an older save that
                // failed: an update that hits nothing must not report success.
                if changed == 0 {
                    return Err(format!("chat {id} is gone"));
                }
                id
            }
            None => {
                conn.execute(
                    "INSERT INTO chats (title, model, reasoning, servers, messages, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    params![title, model, reasoning, ids, raw, now],
                )
                .map_err(err)?;
                conn.last_insert_rowid()
            }
        };
        Ok(ChatSummary {
            id,
            title: title.to_owned(),
            updated_at: now,
            model: model.to_owned(),
            reasoning: reasoning.to_owned(),
        })
    }

    /// Renames a chat, leaving its transcript alone.
    ///
    /// `updated_at` is left as it was: it orders the list and decides which day a
    /// chat is filed under, and both follow the conversation, not its name.
    pub fn rename(&self, id: i64, title: &str) -> Result<(), String> {
        let conn = self.conn.lock();
        let changed = conn
            .execute("UPDATE chats SET title = ?2 WHERE id = ?1", params![id, title])
            .map_err(err)?;
        if changed == 0 {
            return Err(format!("chat {id} is gone"));
        }
        Ok(())
    }

    /// Removes a chat and its transcript.
    pub fn delete(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM chats WHERE id = ?1", [id])
            .map_err(err)?;
        Ok(())
    }
}

/// The store's errors are strings on their way to a log line and a failed
/// command, so nothing here needs the `rusqlite` error type kept alive.
fn err(e: rusqlite::Error) -> String {
    e.to_string()
}

#[cfg(test)]
mod tests {
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

        let saved = store.save(None, "hi", "test/model", "high", None, &messages, 1_700_000_000_000).unwrap();
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

        let undecided = store.save(None, "fresh", "test/model", "", None, &empty, 10).unwrap();
        assert_eq!(store.load(undecided.id).unwrap().unwrap().servers, None);

        let chosen = store.save(None, "picky", "test/model", "", Some(&ids), &empty, 20).unwrap();
        assert_eq!(
            store.load(chosen.id).unwrap().unwrap().servers,
            Some(ids.clone())
        );

        let quiet = store.save(None, "quiet", "test/model", "", Some(&[]), &empty, 30).unwrap();
        assert_eq!(store.load(quiet.id).unwrap().unwrap().servers, Some(vec![]));

        // And the choice is replaced, not added to, when the chat is written again.
        store.save(Some(chosen.id), "picky", "test/model", "", Some(&[]), &empty, 40).unwrap();
        assert_eq!(store.load(chosen.id).unwrap().unwrap().servers, Some(vec![]));
    }

    /// The frontend reads `id`, `title` and `updatedAt` off a row, the model it
    /// is holding, and the reasoning level it is asking with. Renaming a field,
    /// or losing the attribute that camel-cases it, would leave the sidebar
    /// sorting and grouping by nothing at all.
    #[test]
    fn a_row_crosses_to_the_frontend_as_it_is_read() {
        let store = Store::in_memory().unwrap();
        let chat = store.save(None, "one", "test/model", "low", None, &json!([]), 42).unwrap();

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
        let chat = store.save(None, "one", "test/model", "high", None, &json!([{ "role": "user", "content": "hi" }]), 7).unwrap();
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

        let chat = store.save(None, "one", "test/model", "low", None, &first, 10).unwrap();
        store.save(Some(chat.id), "one", "test/model", "high", None, &second, 20).unwrap();

        assert_eq!(store.list().unwrap().len(), 1);
        let loaded = store.load(chat.id).unwrap().unwrap();
        assert_eq!(loaded.messages, second);
        assert_eq!(loaded.reasoning, "high");
    }

    #[test]
    fn listing_is_most_recently_written_first() {
        let store = Store::in_memory().unwrap();
        let empty = json!([]);
        let old = store.save(None, "old", "test/model", "", None, &empty, 10).unwrap();
        let new = store.save(None, "new", "test/model", "", None, &empty, 30).unwrap();
        let middle = store.save(None, "middle", "test/model", "", None, &empty, 20).unwrap();

        let listed: Vec<i64> = store.list().unwrap().iter().map(|c| c.id).collect();
        assert_eq!(listed, vec![new.id, middle.id, old.id]);
    }

    #[test]
    fn rename_keeps_the_transcript() {
        let store = Store::in_memory().unwrap();
        let messages = json!([{ "role": "user", "content": "keep me" }]);
        let chat = store.save(None, "before", "test/model", "", None, &messages, 10).unwrap();

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
        let chat = store.save(None, "bye", "test/model", "", None, &json!([]), 10).unwrap();

        store.delete(chat.id).unwrap();

        assert!(store.load(chat.id).unwrap().is_none());
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn saving_a_deleted_chat_fails() {
        let store = Store::in_memory().unwrap();
        let chat = store.save(None, "gone", "test/model", "", None, &json!([]), 10).unwrap();
        store.delete(chat.id).unwrap();

        assert!(store.save(Some(chat.id), "gone", "test/model", "", None, &json!([]), 20).is_err());
    }
}
