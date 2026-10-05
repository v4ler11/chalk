/**
 * The window's view of the runs Rust is holding.
 *
 * A run lives in the backend, so the window is a subscriber to it and nothing
 * more: it reads a snapshot when a chat is opened, and while it watches a chat
 * it is fed two events. Everything the feed draws — whether a chat is going,
 * how many replies it has, whether it is the user's move — is read from here, so
 * a window closed and opened again finds the turn where it was.
 *
 * The store is module-level rather than a hook because the events arrive
 * whether or not a component is mounted to hear them: a delta that lands while
 * the channel is showing is not lost, it is there when the thread is opened.
 */
import { listen } from "@tauri-apps/api/event";
import type { Partial, RunSnapshot, RunSummary } from "./types";
import * as api from "./api";

/**
 * One chat's run as the window knows it: the full snapshot once a thread has
 * been opened on it, and the summary alone for a chat only heard of — a chat
 * running in the background, whose row the feed still has to draw.
 */
export type RunEntry =
  | { kind: "snapshot"; snapshot: RunSnapshot }
  | { kind: "summary"; summary: RunSummary };

const entries = new Map<number, RunEntry>();
const listeners = new Set<() => void>();
// The entries as one value, replaced whole whenever one of them changes, so a
// React subscriber can tell a change by identity rather than by comparing maps.
let view: ReadonlyMap<number, RunEntry> = new Map();
let startPromise: Promise<void> | null = null;

/** What the feed does when a run names a chat the store has not heard of. */
let refreshChats: (() => void) | null = null;

function emit() {
  view = new Map(entries);
  for (const listener of listeners) listener();
}

/** The runs as they stand, in the shape React compares by identity. */
export function getRuns(): ReadonlyMap<number, RunEntry> {
  return view;
}

/**
 * Registers what to do when a run names a chat with no row yet: the store holds
 * runs, not chats, so the feed is the one that can read the list again and give
 * the row somewhere to be drawn.
 */
export function setChatsRefresher(refresh: (() => void) | null) {
  refreshChats = refresh;
}

/**
 * Subscribes to the store, starting the events on the first subscriber. The
 * returned function is what React calls to let go.
 */
export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  void start();
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Reads every run there is, and starts listening for the two events that keep
 * the store current. It is idempotent: the first use pays for it, and every use
 * after reads what is already there.
 */
function start(): Promise<void> {
  if (startPromise) return startPromise;
  startPromise = (async () => {
    try {
      await listen<RunSummary>("run-changed", (event) => changed(event.payload));
      await listen<{ chat: number; partial: Partial | null }>("run-delta", (event) =>
        delta(event.payload),
      );
      await refresh();
    } catch {
      // No backend to listen to — the harness, or a window before Rust is up.
      // The store stays empty and the feed reads the row's own state.
    }
  })();
  return startPromise;
}

/** Every run there is, merged into what is already known. */
async function refresh(): Promise<void> {
  const summaries = await api.runsState();
  for (const summary of summaries) {
    const entry = entries.get(summary.chat);
    if (entry?.kind === "snapshot") {
      entries.set(summary.chat, {
        kind: "snapshot",
        snapshot: { ...entry.snapshot, status: summary.status, replies: summary.replies },
      });
    } else {
      entries.set(summary.chat, { kind: "summary", summary });
    }
  }
  emit();
}

/**
 * A run's state moved: it started, parked on the user, or finished. The summary
 * is what the feed draws, and the snapshot — for a chat whose thread is open —
 * is read again, since the calls waiting on the user and the transcript are only
 * in the full snapshot.
 */
function changed(summary: RunSummary) {
  const entry = entries.get(summary.chat);
  if (entry?.kind === "snapshot") {
    entries.set(summary.chat, {
      kind: "snapshot",
      snapshot: { ...entry.snapshot, status: summary.status, replies: summary.replies },
    });
    void loadRun(summary.chat).catch(() => {});
  } else {
    entries.set(summary.chat, { kind: "summary", summary });
  }
  if (!entry) refreshChats?.();
  emit();
}

/**
 * The answer arriving, whole: Rust coalesces the pushes, so what arrives is the
 * accumulated text and it replaces whatever partial the window had. Only a chat
 * whose snapshot is held has a partial to replace — a thread the window is
 * showing. A background chat's delta is dropped, since the feed reads its phase
 * from the summary and a fetch per push would be a fetch per token.
 */
function delta(payload: { chat: number; partial: Partial | null }) {
  const entry = entries.get(payload.chat);
  if (entry?.kind !== "snapshot") return;
  entries.set(payload.chat, {
    kind: "snapshot",
    snapshot: { ...entry.snapshot, partial: payload.partial },
  });
  emit();
}

/**
 * Reads one chat as a window opened on it reads it. The snapshot replaces what
 * the store had for that chat, since the run is the truth while it is going.
 */
export async function loadRun(chat: number): Promise<RunSnapshot | null> {
  const snapshot = await api.runState(chat);
  if (snapshot) {
    entries.set(chat, { kind: "snapshot", snapshot });
    emit();
  }
  return snapshot;
}

/** Lets go of a chat that is gone, so the feed is not drawing a run nobody has. */
export function forget(chat: number) {
  if (!entries.delete(chat)) return;
  emit();
}
