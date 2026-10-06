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

/// The schema, at `user_version` 5: when a chat was made, and the prompt it was
/// made of.
///
/// `id` used to be enough to order the history by creation, and it no longer is:
/// the channel draws threads in the order they were posted, and a thread that is
/// answered again must not jump to the end of that order — which is exactly what
/// `updated_at`, rewritten on every answer, would do. `root` is the first prompt
/// as written, kept rather than derived, so a list can draw a thread without the
/// transcript it came from; how much follows it is still read off the transcript,
/// where it cannot drift.
const V5_COLUMNS: &str = "
ALTER TABLE chats ADD COLUMN created_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE chats ADD COLUMN root TEXT NOT NULL DEFAULT '';
";

/// The rows that were already there: their creation is not recorded anywhere, so
/// the last write is the best account of it, and their first prompt is in the
/// transcript under a key the window writes.
///
/// Run apart from the columns and without its failures raised: a database
/// without the JSON functions still gets the columns, and a `root` left empty is
/// a row the window draws by its title — which is the same prompt, cut to what a
/// row holds.
const V5_BACKFILL: &str = "
UPDATE chats SET created_at = updated_at WHERE created_at = 0;
UPDATE chats SET root = COALESCE(
    CASE json_type(messages, '$[0].content')
        WHEN 'text' THEN json_extract(messages, '$[0].content')
        ELSE json_extract(messages, '$[0].content[0].text')
    END, '')
WHERE root = '';
";

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
    /// Unix time in milliseconds of the chat's creation, which is what a channel
    /// orders by: a thread posted an hour ago stays above one posted a minute
    /// ago, however late either of them is answered.
    pub created_at: i64,
    /// The first prompt as it was written, or empty on a row whose transcript
    /// does not say — a list falls back to the title, which is that same prompt
    /// cut to what a row holds.
    pub root: String,
    /// How many messages follow that first one: what a thread has said since it
    /// was posted, counting the user's own and the model's answers and leaving
    /// out the tools' results in between, which are what was done rather than
    /// anything said. Zero while nothing has come back.
    pub replies: i64,
    /// How many pictures the prompt was posted with. A count rather than the
    /// pictures themselves: an attachment is a data URL of a megabyte or more,
    /// and a list read on every post is no place to carry one. A row that has
    /// any asks for them by id, when it is drawn.
    pub images: i64,
}

/// A chat and its transcript.
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatRecord {
    pub id: i64,
    /// Unix time in milliseconds of the row's last write, which is when its last
    /// message landed. Not the row's own business but its caller's: a change of
    /// model or level is written through the same save a message is, and a row
    /// that moved for one of those would say a thread had been answered when it
    /// had only been retuned.
    pub updated_at: i64,
    pub title: String,
    pub model: String,
    pub reasoning: String,
    /// The ids of the servers this chat offers, or `None` while it has never
    /// chosen — which offers every enabled server.
    pub servers: Option<Vec<String>>,
    /// The transcript exactly as it was written.
    pub messages: Value,
}

/// The prompt a thread was opened with, as the query a list is drawn from reads
/// it: the first thing the user said. Read through `json_each` rather than at
/// `$[0]`, since what a transcript starts with is the first *user* message and
/// not whatever happens to sit at that index.
///
/// What it hands back is JSON either way, which is the point of the case: a
/// prompt of words alone has a string there and one with pictures has a list of
/// parts, and reading a string back as a bare string would leave whatever walks
/// it next with something that is not JSON at all — which is not "no pictures",
/// it is an error.
const ROOT_CONTENT: &str = "\
SELECT CASE json_type(value, '$.content')
         WHEN 'array' THEN json_extract(value, '$.content')
         WHEN 'text'  THEN json_quote(json_extract(value, '$.content'))
         ELSE '[]'
       END
FROM json_each(messages) WHERE json_extract(value, '$.role') = 'user' LIMIT 1";

/// The columns a list is drawn from, in the order [`summary_row`] reads them.
///
/// How many replies a thread has is derived here rather than kept beside it: it
/// is the one value in a row that can be told without guessing, so it is told —
/// and told the same way the run tells it, which is why the tools' results are
/// left out. A turn that called three tools and then answered has said two
/// things, not five.
///
/// The pictures the prompt carried are counted here too, and not carried: the
/// count is what tells a row whether it has any to ask for.
///
/// They are summed over the parts rather than counted with a filter, and the
/// branch is on the type `json_each` itself reports for each element: what a
/// path is asked about has to be an object, and the `value` a walk hands back is
/// an SQL value — a part that is a piece of text comes back as bare text, which
/// is not JSON and cannot be asked for a path at all.
fn summary_columns() -> String {
    format!(
        "id, title, updated_at, model, reasoning, created_at, root, \
         MAX((SELECT COUNT(*) FROM json_each(messages) \
              WHERE json_extract(value, '$.role') IN ('user', 'assistant')) - 1, 0), \
         (SELECT COALESCE(SUM(CASE parts.type \
                                WHEN 'object' THEN json_extract(parts.value, '$.type') = 'image_url' \
                                ELSE 0 END), 0) \
          FROM json_each(({ROOT_CONTENT})) AS parts)"
    )
}

/// One row of that list.
fn summary_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<ChatSummary> {
    Ok(ChatSummary {
        id: row.get(0)?,
        title: row.get(1)?,
        updated_at: row.get(2)?,
        model: row.get(3)?,
        reasoning: row.get(4)?,
        created_at: row.get(5)?,
        root: row.get(6)?,
        replies: row.get(7)?,
        images: row.get(8)?,
    })
}

/// The first prompt in a transcript, as written: what a list draws a thread as.
/// A prompt with a picture in it is still a prompt that was written, so its
/// words are what is kept and the parts that are not words are not.
fn first_prompt(messages: &Value) -> String {
    prompt_text(&root_content(messages))
}

/// The content of the prompt a transcript was opened with, or nothing on a row
/// whose transcript does not say — a transcript with no message from the user in
/// it at all.
fn root_content(messages: &Value) -> Value {
    messages
        .as_array()
        .and_then(|all| {
            all.iter()
                .find(|message| message.get("role").and_then(Value::as_str) == Some("user"))
        })
        .and_then(|first| first.get("content"))
        .cloned()
        .unwrap_or(Value::Null)
}

/// What a prompt's content says, in words.
fn prompt_text(content: &Value) -> String {
    match content {
        Value::String(text) => text.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|part| part.get("text").and_then(Value::as_str))
            .collect::<Vec<&str>>()
            .join(" "),
        _ => String::new(),
    }
}

/// The pictures a prompt carries, in the order it carries them: what a row in
/// the feed draws beside the words, and what a prompt asked again as it was
/// hands back with them.
fn prompt_images(content: &Value) -> Vec<String> {
    let Value::Array(parts) = content else {
        return Vec::new();
    };
    parts
        .iter()
        .filter_map(|part| {
            if part.get("type").and_then(Value::as_str) != Some("image_url") {
                return None;
            }
            part.get("image_url")?
                .get("url")?
                .as_str()
                .map(str::to_string)
        })
        .collect()
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
        if version < 5 {
            conn.execute_batch(V5_COLUMNS).map_err(err)?;
            let _ = conn.execute_batch(V5_BACKFILL);
            conn.pragma_update(None, "user_version", 5).map_err(err)?;
        }
        Ok(())
    }

    /// The chats, most recently made first. Not most recently written: a thread
    /// answered just now belongs where it was posted, not at the top of a list
    /// that is ordered by what happened last to it.
    pub fn list(&self) -> Result<Vec<ChatSummary>, String> {
        let conn = self.conn.lock();
        let mut stmt = conn
            .prepare(&format!(
                "SELECT {} FROM chats ORDER BY created_at DESC, id DESC",
                summary_columns()
            ))
            .map_err(err)?;
        let rows = stmt.query_map([], summary_row).map_err(err)?;
        rows.collect::<Result<Vec<_>, _>>().map_err(err)
    }

    /// The pictures the prompt a chat was opened with carried, as the data URLs
    /// they were sent as, in the order they were attached.
    ///
    /// Read on their own rather than with the row: a list is drawn from counts,
    /// and what a megabyte of data URL is for is the window that is drawing it.
    pub fn root_images(&self, id: i64) -> Result<Vec<String>, String> {
        let conn = self.conn.lock();
        let content: Option<String> = conn
            .query_row(
                &format!("SELECT ({ROOT_CONTENT}) FROM chats WHERE id = ?1"),
                [id],
                |row| row.get(0),
            )
            .optional()
            .map_err(err)?
            .flatten();
        let Some(content) = content else {
            return Ok(Vec::new());
        };
        // A content that is not a list of parts is a prompt of words alone,
        // which holds no picture to draw.
        let parsed: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        Ok(prompt_images(&parsed))
    }

    /// One chat with its transcript, or `None` if the row is gone.
    pub fn load(&self, id: i64) -> Result<Option<ChatRecord>, String> {
        let conn = self.conn.lock();
        let row = conn
            .query_row(
                "SELECT id, updated_at, title, model, reasoning, servers, messages FROM chats WHERE id = ?1",
                [id],
                |row| {
                    Ok((
                        row.get::<_, i64>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4)?,
                        row.get::<_, String>(5)?,
                        row.get::<_, String>(6)?,
                    ))
                },
            )
            .optional()
            .map_err(err)?;

        row.map(|(id, updated_at, title, model, reasoning, servers, raw)| {
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
                updated_at,
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
                        "UPDATE chats SET title = ?2, model = ?3, reasoning = ?4, servers = ?5, messages = ?6, updated_at = ?7, root = ?8 WHERE id = ?1",
                        params![id, title, model, reasoning, ids, raw, now, first_prompt(messages)],
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
                    "INSERT INTO chats (title, model, reasoning, servers, messages, updated_at, created_at, root) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7)",
                    params![title, model, reasoning, ids, raw, now, first_prompt(messages)],
                )
                .map_err(err)?;
                conn.last_insert_rowid()
            }
        };
        // Read back rather than assembled from the arguments: the row a write
        // answers with has to say what the row says, and what it says about when
        // it was made and how much follows its first prompt are the row's own.
        conn.query_row(
            &format!("SELECT {} FROM chats WHERE id = ?1", summary_columns()),
            [id],
            summary_row,
        )
        .map_err(err)
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
#[path = "tests/store.rs"]
mod tests;

