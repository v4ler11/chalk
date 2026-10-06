import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  asReasoningLevel,
  contentText,
  userContent,
  type AppConfig,
  type ChatSummary,
  type McpFailure,
  type McpServer,
  type ReasoningLevel,
  type RunStatus,
  type ToolCallRequest,
  type UiMessage,
} from "./types";
import * as api from "./api";
import { offeredServers } from "./components/ServersMenu";
import { waiting } from "./lazy";
import { defaultModel } from "./conversation";
import { forget, loadRun, setChatsRefresher } from "./runs";
import { useRuns } from "./useRuns";
import type { JsonTab } from "./components/JsonView";

/** Which of the window's two views is showing: the channel's feed of threads,
 *  or one thread's own transcript. */
export type View = { kind: "channel" } | { kind: "thread"; chat: number };

/** One row of the channel's feed: a thread's root message, and where its run is. */
export interface FeedRow {
  chat: number;
  root: string;
  createdAt: number;
  replies: number;
  /** How many pictures the prompt was posted with, which is what tells the row
   *  whether it has any to draw — the pictures themselves are read by the row. */
  images: number;
  /** The model this thread is with: who answered it, as its circle is drawn. */
  model: string;
  /** Unix time in ms of the thread's last message, which is when it was last
   *  answered: what the channel says under the reply count. A change of model
   *  or level leaves it where it was, since it is not a reply. */
  updatedAt: number;
  status: RunStatus;
  /** True while the turn is going and no answer token has arrived yet. */
  thinking: boolean;
  /** How many tool calls are waiting on the user. */
  awaiting: number;
  /** Whether this row's thread is the one open. */
  active: boolean;
}

interface Options {
  config: AppConfig | null;
  servers: McpServer[];
  failures: McpFailure[];
  /** Reports a failure without letting it escape a callback. */
  setError: (message: string) => void;
  /** Sending, opening a thread or posting is an explicit wish to see the end. */
  setFollow: (follow: boolean) => void;
  /** The composer's field, so a post can hand the caret back to it. */
  composerRef: RefObject<HTMLTextAreaElement | null>;
}

/** The conversation as a verb reads it: the open thread and its run, and the
 *  values the next prompt is sent with. Held by identity in a ref, so the
 *  message actions — which are handed to every message and must keep their
 *  identity — read the latest values rather than the render that made them. */
interface Live {
  config: AppConfig | null;
  chats: ChatSummary[];
  thread: number | null;
  messages: UiMessage[];
  status: RunStatus;
  model: string;
  reasoning: ReasoningLevel;
  chosen: string[] | null;
  composeModel: string;
  composeReasoning: ReasoningLevel;
  composeChosen: string[] | null;
  editing: { index: number; text: string } | null;
}

const EMPTY_MESSAGES: UiMessage[] = [];
const EMPTY_IDS: string[] = [];
const EMPTY_CALLS: ToolCallRequest[] = [];

/**
 * The window's own state: which view is showing and its modes, the channel's
 * feed, and the open thread as its run reports it — plus the verbs that ask Rust
 * for something. The run itself lives in the backend, so nothing here streams:
 * `runs.ts` holds what Rust says, and this reads it.
 *
 * Gating is per thread: a run in one chat never blocks posting another or
 * opening a third, since the window is a subscriber and not the work.
 */
export function useConversation({ config, servers, failures, setError, setFollow, composerRef }: Options) {
  const [view, setView] = useState<View>({ kind: "channel" });
  // The window's modes, taken over the pane: the settings form, and the JSON
  // view of the open thread. They are the window's rather than any chat's.
  const [settingsView, setSettingsView] = useState(false);
  const [jsonView, setJsonView] = useState(false);
  const [jsonTab, setJsonTab] = useState<JsonTab>("history");
  const [chats, setChats] = useState<ChatSummary[]>([]);
  // The prompt being rewritten in a thread's composer: where it sits, and what
  // it said. Sending the edit starts the turn over from there.
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  // What the next channel post is sent with, until the thread it becomes owns
  // them: the nav's model chip and the composer's controls in the channel edit
  // these, and the thread's own are written through `chat_set`.
  const [composeModel, setComposeModel] = useState("");
  const [composeReasoning, setComposeReasoning] = useState<ReasoningLevel>("");
  const [composeChosen, setComposeChosen] = useState<string[] | null>(null);

  const runs = useRuns();
  const thread = view.kind === "thread" ? view.chat : null;
  const entry = thread === null ? undefined : runs.get(thread);
  const snapshot = entry?.kind === "snapshot" ? entry.snapshot : null;

  // The open thread, as its run reports it. Everything below reads the snapshot
  // or, for a thread whose snapshot has not arrived yet, a quiet empty state.
  const messages = snapshot?.messages ?? EMPTY_MESSAGES;
  const pending = snapshot?.partial ?? null;
  const status = snapshot?.status ?? "idle";
  const loaded = snapshot?.loaded ?? EMPTY_IDS;
  const awaiting = snapshot?.awaiting ?? EMPTY_CALLS;
  const threadError = snapshot?.error ?? "";
  // In the channel the composer edits the next post's values; in a thread it
  // edits the thread's own, which are written through `chat_set`.
  const model = thread === null ? composeModel || defaultModel(chats, config) : snapshot?.model ?? "";
  const reasoning = thread === null ? composeReasoning : asReasoningLevel(snapshot?.reasoning ?? "");
  const chosen = thread === null ? composeChosen : snapshot?.servers ?? null;
  // What the channel calls the person writing: their own name, and "You" until
  // they have written one — the feed draws it, with a circle of its initials,
  // beside every prompt it holds.
  const author = (config?.name ?? "").trim() || "You";
  // A prompt's actions are offered while its thread is not answering: a run that
  // is only queued still counts as answering, so its transcript is left alone.
  const canAct = thread !== null && status !== "running" && config !== null;

  // A server the open thread calls and nobody can reach is worth saying: its
  // tools are absent from the request, and an absence is not a reason. A lazy
  // server not yet loaded is outside this, since none of what it holds is in the
  // request by design.
  const unloaded = new Set(
    waiting({ servers, chosen, loaded, failed: failures.map((failure) => failure.server) }).map(
      (server) => server.id,
    ),
  );
  const unreachable = failures
    .filter((failure) => !unloaded.has(failure.server))
    .filter((failure) => offeredServers(servers, chosen).includes(failure.server))
    .map((failure) => `${failure.name || failure.server}: ${failure.message}`)
    .join("\n");

  const live = useRef<Live>({
    config,
    chats,
    thread,
    messages,
    status,
    model,
    reasoning,
    chosen,
    composeModel,
    composeReasoning,
    composeChosen,
    editing,
  });
  live.current = {
    config,
    chats,
    thread,
    messages,
    status,
    model,
    reasoning,
    chosen,
    composeModel,
    composeReasoning,
    composeChosen,
    editing,
  };
  const actions = useRef({ setError, setFollow, composerRef });
  actions.current = { setError, setFollow, composerRef };

  /** Reports a backend failure without letting it escape the callback. */
  const fail = useCallback((e: unknown) => actions.current.setError(String(e)), []);

  /** Re-reads the history, which a post, a rename or a delete leaves stale. */
  const refreshChats = useCallback(async () => {
    try {
      setChats(await api.listChats());
    } catch (e) {
      fail(e);
    }
  }, [fail]);

  // The history on the way in, and again whenever a run names a chat the store
  // has not heard of — a thread born in another window, or one just posted to.
  useEffect(() => {
    void refreshChats();
  }, [refreshChats]);
  useEffect(() => {
    setChatsRefresher(() => {
      void refreshChats();
    });
    return () => setChatsRefresher(null);
  }, [refreshChats]);

  // The caret belongs in the composer: the window opens on the feed to write
  // into it, and a thread is opened to reach for its composer too. The same ref
  // is the field whichever composer is mounted, and while the JSON view or the
  // settings take the pane there is no field to focus, which is a no-op.
  useEffect(() => {
    composerRef.current?.focus();
  }, [view, composerRef]);

  // What the next post inherits: the newest chat's level, and the servers the
  // first thread opened was sent with. Primed once, so a later choice of the
  // channel composer's own is not overwritten by the history moving.
  const primedReasoning = useRef(false);
  useEffect(() => {
    if (primedReasoning.current || chats.length === 0) return;
    primedReasoning.current = true;
    setComposeReasoning(asReasoningLevel(chats[0].reasoning));
  }, [chats]);
  const primedChosen = useRef(false);
  useEffect(() => {
    if (primedChosen.current || !snapshot) return;
    primedChosen.current = true;
    setComposeChosen(snapshot.servers);
  }, [snapshot]);

  /** Changes what the open thread is sent with next time, through `chat_set`. A
   *  thread that is answering is left alone: its row is written whole by its run. */
  const change = useCallback((patch: api.ChatChange) => {
    const { thread: chat, status: state } = live.current;
    if (chat === null) return;
    if (state === "running" || state === "awaiting") {
      actions.current.setError("This thread is still answering.");
      return;
    }
    void api
      .chatSet(chat, patch)
      .then(() => loadRun(chat))
      .catch((e) => actions.current.setError(String(e)));
  }, []);

  const setModel = useCallback(
    (next: string) => {
      if (live.current.thread === null) setComposeModel(next);
      else change({ model: next });
    },
    [change],
  );
  const setReasoning = useCallback(
    (level: ReasoningLevel) => {
      if (live.current.thread === null) setComposeReasoning(level);
      else change({ reasoning: level });
    },
    [change],
  );
  const setChosen = useCallback(
    (ids: string[] | null) => {
      if (live.current.thread === null) setComposeChosen(ids);
      else change({ servers: ids });
    },
    [change],
  );

  /**
   * A channel post: the message is the thread. The run starts in the background
   * and the feed is read again so its row is there, with the answer arriving
   * under it while the user stays in the channel.
   */
  const post = useCallback(
    (text: string, images: string[]) => {
      const { config: settings, model: asked, composeReasoning: level, composeChosen: chosenIds } = live.current;
      if (!settings) return;
      actions.current.setError("");
      actions.current.setFollow(true);
      void api
        .runStart(null, userContent(text, images), asked, level, chosenIds, null)
        .then(async ({ chat }) => {
          actions.current.composerRef.current?.focus();
          await refreshChats();
          await loadRun(chat);
        })
        .catch((e) => actions.current.setError(String(e)));
    },
    [refreshChats],
  );

  /** Opens a thread, whether or not it is already running: the run's snapshot is
   *  read and the answer arriving comes with it. */
  const openThread = useCallback((chat: number) => {
    setSettingsView(false);
    setEditing(null);
    actions.current.setFollow(true);
    actions.current.setError("");
    setView({ kind: "thread", chat });
    void loadRun(chat).catch((e) => actions.current.setError(String(e)));
  }, []);

  /** Returns to the feed. The JSON view belongs to a thread, so it is left. */
  const backToChannel = useCallback(() => {
    setEditing(null);
    setJsonView(false);
    setView({ kind: "channel" });
  }, []);

  /** The composer's send inside a thread. A prompt being rewritten cuts the
   *  transcript back to it first, so the turn starts over from the edit. */
  const submit = useCallback((text: string, images: string[]) => {
    const { thread: chat, model: asked, reasoning: level, chosen: chosenIds, editing: rewrite } = live.current;
    if (chat === null) return;
    const keep = rewrite?.index ?? null;
    setEditing(null);
    actions.current.setError("");
    actions.current.setFollow(true);
    void api
      .runStart(chat, userContent(text, images), asked, level, chosenIds, keep)
      .then(() => loadRun(chat))
      .catch((e) => actions.current.setError(String(e)));
  }, []);

  /** Asks again for the answer to the prompt at `index`, dropping what followed:
   *  the prompt goes back exactly as it was sent, images included. */
  const regenerate = useCallback((index: number) => {
    const { thread: chat, messages: transcript, model: asked, reasoning: level, chosen: chosenIds } = live.current;
    if (chat === null) return;
    const message = transcript[index];
    if (!message) return;
    setEditing(null);
    actions.current.setError("");
    actions.current.setFollow(true);
    void api
      .runStart(chat, message.content ?? "", asked, level, chosenIds, index)
      .then(() => loadRun(chat))
      .catch((e) => actions.current.setError(String(e)));
  }, []);

  /** Hands the prompt at `index` to the composer to be rewritten. */
  const startEdit = useCallback((index: number) => {
    const message = live.current.messages[index];
    if (!message) return;
    setEditing({ index, text: contentText(message.content) });
  }, []);

  const stop = useCallback(() => {
    const chat = live.current.thread;
    if (chat === null) return;
    void api.runStop(chat).catch((e) => actions.current.setError(String(e)));
  }, []);
  const allow = useCallback(() => {
    const chat = live.current.thread;
    if (chat === null) return;
    void api.runAllow(chat).catch((e) => actions.current.setError(String(e)));
  }, []);
  const decline = useCallback(() => {
    const chat = live.current.thread;
    if (chat === null) return;
    void api.runDecline(chat).catch((e) => actions.current.setError(String(e)));
  }, []);

  const renameChat = useCallback(
    async (id: number, title: string) => {
      try {
        await api.renameChat(id, title);
        setChats((all) => all.map((chat) => (chat.id === id ? { ...chat, title } : chat)));
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  const deleteChat = useCallback(
    async (id: number) => {
      try {
        await api.deleteChat(id);
        forget(id);
        setChats((all) => all.filter((chat) => chat.id !== id));
        // A deleted thread is not one to keep showing.
        setView((current) => (current.kind === "thread" && current.chat === id ? { kind: "channel" } : current));
      } catch (e) {
        fail(e);
      }
    },
    [fail],
  );

  /** Opens the settings, or puts them away: the form takes the pane, so the
   *  button that opened it is also the way back, and the JSON view is given up. */
  const toggleSettings = useCallback(() => {
    setSettingsView((open) => !open);
    setJsonView(false);
  }, []);
  const showJson = useCallback((on: boolean) => {
    setJsonView(on);
    if (on) setSettingsView(false);
  }, []);
  const leaveSettings = useCallback(() => setSettingsView(false), []);
  const closeJson = useCallback(() => setJsonView(false), []);

  // The feed, oldest first: each thread's root message, with its run's phase.
  // The phase comes from `status` and `thinking`, never from `replies`, which
  // stays still for the whole of a run and only moves when the answer lands.
  const rows = useMemo<FeedRow[]>(() => {
    const ordered = [...chats].sort((a, b) => a.createdAt - b.createdAt);
    return ordered.map((chat) => {
      const run = runs.get(chat.id);
      const status: RunStatus =
        run?.kind === "snapshot" ? run.snapshot.status : run?.kind === "summary" ? run.summary.status : "idle";
      const thinking =
        run?.kind === "snapshot"
          ? run.snapshot.status === "running" &&
            (run.snapshot.partial === null || run.snapshot.partial.thinking)
          : run?.kind === "summary"
            ? run.summary.thinking
            : false;
      const awaiting =
        run?.kind === "snapshot"
          ? run.snapshot.awaiting.length
          : run?.kind === "summary"
            ? run.summary.awaiting
            : 0;
      const replies =
        run?.kind === "snapshot"
          ? run.snapshot.replies
          : run?.kind === "summary"
            ? run.summary.replies
            : chat.replies;
      return {
        chat: chat.id,
        root: chat.root,
        createdAt: chat.createdAt,
        replies,
        images: chat.images,
        model: chat.model,
        updatedAt: chat.updatedAt,
        status,
        thinking,
        awaiting,
        active: thread === chat.id,
      };
    });
  }, [chats, runs, thread]);

  return {
    view,
    settingsView,
    jsonView,
    jsonTab,
    setJsonTab,
    toggleSettings,
    showJson,
    leaveSettings,
    closeJson,
    rows,
    messages,
    pending,
    awaiting,
    threadError,
    unreachable,
    canAct,
    model,
    reasoning,
    chosen,
    author,
    loaded,
    editing,
    setEditing,
    post,
    openThread,
    backToChannel,
    submit,
    regenerate,
    startEdit,
    stop,
    allow,
    decline,
    renameChat,
    deleteChat,
    setModel,
    setReasoning,
    setChosen,
  };
}
