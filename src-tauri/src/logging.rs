//! In-memory ring-buffer logger for the running app.
//!
//! Entries are kept for the in-app Logs panel (fetched via `get_logs`) and
//! pushed live to the webview as `app-log` events. [`Logger::push`] does not
//! print; the caller decides whether to also write to stderr.

use std::collections::VecDeque;

use parking_lot::Mutex;
use serde::Serialize;

/// Maximum number of entries retained.
const CAPACITY: usize = 500;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Monotonic id, used by the frontend to dedupe backfill vs live events.
    pub id: u64,
    /// `info` | `warn` | `error`.
    pub level: String,
    pub message: String,
    /// Unix time in milliseconds.
    pub timestamp: i64,
}

#[derive(Default)]
pub struct Logger {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    next_id: u64,
    entries: VecDeque<LogEntry>,
}

impl Logger {
    /// Records an entry and returns a clone of it.
    pub fn push(&self, level: &str, message: String) -> LogEntry {
        let mut inner = self.inner.lock();
        let entry = LogEntry {
            id: inner.next_id,
            level: level.to_owned(),
            message,
            timestamp: now_millis(),
        };
        inner.next_id += 1;
        if inner.entries.len() >= CAPACITY {
            inner.entries.pop_front();
        }
        inner.entries.push_back(entry.clone());
        entry
    }

    /// All retained entries, oldest first.
    pub fn snapshot(&self) -> Vec<LogEntry> {
        self.inner.lock().entries.iter().cloned().collect()
    }
}

pub(crate) fn now_millis() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
