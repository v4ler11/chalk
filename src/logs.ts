/**
 * In-app log store.
 *
 * Collects entries from two sources: the Rust backend (backfilled via the
 * `get_logs` command and streamed live as `app-log` events) and the webview
 * itself (console.error/warn, uncaught errors, unhandled rejections).
 *
 * A small external store so the log panel and the error badge can subscribe
 * without forcing the whole app to re-render on every entry.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogEntry {
  /** Backend-assigned sequence id; absent for webview-origin entries. */
  id?: number;
  level: LogLevel;
  message: string;
  timestamp: number;
}

const MAX = 500;

let entries: LogEntry[] = [];
let installed = false;
const listeners = new Set<() => void>();
const seenIds = new Set<number>();

function notify() {
  for (const listener of listeners) listener();
}

/** Appends a webview-origin entry. */
export function pushLog(level: LogLevel, message: string, timestamp = Date.now()) {
  entries = [...entries, { level, message, timestamp }].slice(-MAX);
  notify();
}

/** Appends backend entries, skipping any already seen (id-based dedupe). */
export function pushBackendLogs(incoming: LogEntry[]) {
  const fresh = incoming.filter((entry) => {
    if (entry.id === undefined) return true;
    if (seenIds.has(entry.id)) return false;
    seenIds.add(entry.id);
    return true;
  });
  if (fresh.length === 0) return;

  const appended = fresh.map((entry) => ({
    // The backend only sends info/warn/error, but coerce defensively.
    level: entry.level === "error" || entry.level === "warn" ? entry.level : ("info" as LogLevel),
    message: entry.message,
    timestamp: entry.timestamp,
  }));
  entries = [...entries, ...appended].slice(-MAX);
  notify();
}

export function getLogs(): LogEntry[] {
  return entries;
}

export function subscribeLogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Number of `error`-level entries. */
export function errorCount(): number {
  let count = 0;
  for (const entry of entries) if (entry.level === "error") count += 1;
  return count;
}

/** Captures webview errors into the log store. Idempotent. */
export function installLogCapture() {
  if (installed) return;
  installed = true;

  const originalError = console.error.bind(console);
  const originalWarn = console.warn.bind(console);

  console.error = (...args: unknown[]) => {
    pushLog("error", args.map(stringify).join(" "));
    originalError(...args);
  };
  console.warn = (...args: unknown[]) => {
    pushLog("warn", args.map(stringify).join(" "));
    originalWarn(...args);
  };

  window.addEventListener("error", (event) => {
    pushLog(
      "error",
      event.error instanceof Error ? (event.error.stack ?? event.error.message) : event.message,
    );
  });
  window.addEventListener("unhandledrejection", (event) => {
    pushLog("error", `Unhandled rejection: ${stringify(event.reason)}`);
  });
}

function stringify(value: unknown): string {
  if (value instanceof Error) return value.stack ?? value.message;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
