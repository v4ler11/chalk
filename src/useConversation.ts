import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  asReasoningLevel,
  contentText,
  userContent,
  type AppConfig,
  type ChatRecord,
  type ChatSummary,
  type McpFailure,
  type McpServer,
  type McpTool,
  type Pending,
  type ReasoningLevel,
  type ToolCallRequest,
  type UiMessage,
} from "./types";
import * as api from "./api";
import { offeredServers } from "./components/ServersMenu";
import { loadable, promptFor, toolsFor, waiting, withLoaded } from "./lazy";
import { conversationName, defaultModel } from "./conversation";
import { useTurn, type LiveState } from "./useTurn";

interface Options {
  config: AppConfig | null;
  servers: McpServer[];
  tools: McpTool[];
  failures: McpFailure[];
  /** Reports a failure without letting it escape a callback. */
  setError: (message: string) => void;
  /** Sending, opening a chat or making one is an explicit wish to see the end. */
  setFollow: (follow: boolean) => void;
  /** The composer's field, so a new chat can hand the caret to it. */
  composerRef: RefObject<HTMLTextAreaElement | null>;
  /** Leaves whatever took the pane over — the settings — when a chat is opened
   *  or made. The JSON view is not left: it is what a chat is shown as. */
  onLeaveMode: () => void;
}

/**
 * The conversation: the open transcript, the chat it belongs to and the history
 * around it, and the writes that keep the store the way the window is. The turn
 * itself — the round trip and the tool loop — is `useTurn`, which this owns.
 */
export function useConversation({
  config,
  servers,
  tools,
  failures,
  setError,
  setFollow,
  composerRef,
  onLeaveMode,
}: Options) {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  // The history, and the open chat's row. The id is null while the open
  // transcript is a draft that has never been sent, which is why a chat enters
  // the history with its first message and not before.
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [chatId, setChatId] = useState<number | null>(null);
  // The prompt being rewritten in the composer: where it sits in the transcript,
  // and what it was sent with. Sending the edit starts the conversation over
  // from there; cancelling leaves the transcript alone.
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  // The model the open chat is holding: chosen under the chip in the nav, saved
  // with the chat, and what the next new chat starts from.
  const [model, setModel] = useState("");
  // How hard the open chat is asking the model to think. Chosen in the composer,
  // saved with the chat the way its model is, and what the next new chat takes up.
  const [reasoning, setReasoning] = useState<ReasoningLevel>("");
  // The servers the open chat is sent with, and `null` while it has never
  // chosen — then every enabled one.
  const [chosen, setChosen] = useState<string[] | null>(null);
  // What this chat has imported lazily: the ids of the servers whose tools its
  // requests carry. It belongs to the chat the way its servers do — but to the
  // window rather than to the file, since a server loaded is loaded for the
  // conversation that asked, and for no other.
  const [loaded, setLoaded] = useState<string[]>([]);
  // The same list where a turn reads it. A load happens inside a turn — the model
  // asks for it halfway through one — and the round after it has to be sent the
  // tools it just brought in, which is sooner than the state reaches a render.
  const loadedNow = useRef<string[]>([]);
  // What each chat has loaded, for as long as the window is open: a chat opened
  // again afterwards is the chat it was, and a new chat starts with nothing.
  const lazyByChat = useRef(new Map<number | null, string[]>());
  // The calls a server asked to be allowed to run, held until the user says so:
  // a tool is an action taken on their behalf, and only a server marked to run
  // automatically is spared the asking.
  const [awaiting, setAwaiting] = useState<{ calls: ToolCallRequest[]; history: UiMessage[] } | null>(null);

  // The transcript, the model, the reasoning level and the servers written with
  // it, held by identity: a re-render that changed nothing, and a chat just read
  // back from the database, both write nothing.
  const saved = useRef<{
    messages: UiMessage[];
    model: string;
    reasoning: ReasoningLevel;
    chosen: string[] | null;
  } | null>(null);
  // Writes are chained behind each other. A transcript is stored whole, so a slow
  // write landing after a newer one would leave the database with the old one.
  const saving = useRef<Promise<void>>(Promise.resolve());
  // What the message actions read when they run. They are handed to every
  // message, and a message is memoized so its markdown is not re-parsed on every
  // streaming token, which means those handlers have to keep their identity for
  // the life of the window — so they read the state they need here, at click
  // time, instead of closing over the render that made them.
  const live = useRef<LiveState>({ messages, pending, config, chats, model, reasoning, servers, tools, chosen, failures });
  useEffect(() => {
    live.current = { messages, pending, config, chats, model, reasoning, servers, tools, chosen, failures };
  });

  /** Reports a backend failure without letting it escape the callback. */
  function fail(e: unknown) {
    setError(String(e));
  }

  /** What this chat's import state is read against. */
  function lazyState() {
    const { servers, chosen, failures } = live.current;
    return {
      servers,
      chosen,
      loaded: loadedNow.current,
      failed: failures.map((failure) => failure.server),
    };
  }

  /**
   * The tools a request is sent: the servers the open chat calls, with the lazy
   * ones among them left out until this chat has loaded them, and the loader
   * while any of them is still waiting to be asked for.
   *
   * Read at the moment of the request rather than taken from the render, because
   * a turn reads it mid-flight, and a load in one round changes what the next
   * round carries.
   */
  function requestTools(): McpTool[] {
    return toolsFor(lazyState(), live.current.tools);
  }

  /** The lazily imported servers the request names in its system prompt. */
  function lazyPrompt() {
    return promptFor(lazyState(), live.current.tools);
  }

  /**
   * Sets what the open chat has loaded — in the ref first, since the turn that
   * is running reads it there, and in the state so the window draws it.
   */
  function setLoadedBoth(next: string[]) {
    loadedNow.current = next;
    setLoaded(next);
  }

  // What each chat has loaded is kept under the chat it belongs to, for the life
  // of the window.
  useEffect(() => {
    lazyByChat.current.set(chatId, loaded);
  }, [chatId, loaded]);

  const turn = useTurn({
    setMessages,
    setPending,
    setAwaiting,
    setError,
    setFollow,
    live,
    awaiting,
    requestTools,
    lazyPrompt,
    loadableServer: (wanted) => loadable(lazyState(), wanted),
    loadedWith: (id) => setLoadedBoth(withLoaded(loadedNow.current, id)),
  });

  /**
   * Takes over a stored chat: its transcript, model and reasoning level become
   * the open ones, and the guard is primed so the write-back does not re-save
   * what it just read.
   */
  function adopt(chat: ChatRecord) {
    const level = asReasoningLevel(chat.reasoning);
    saved.current = { messages: chat.messages, model: chat.model, reasoning: level, chosen: chat.servers };
    setChatId(chat.id);
    setMessages(chat.messages);
    setModel(chat.model);
    setReasoning(level);
    setChosen(chat.servers);
    // What this chat had loaded when it was last open, which is nothing for a
    // chat opened for the first time in this window: imports do not outlive the
    // session, and a chat that needs one again asks for it again.
    setLoadedBoth(lazyByChat.current.get(chat.id) ?? []);
    // A transcript that ends on a call nobody answered — the app was closed, or
    // another chat opened, with the card on screen — is one the provider would
    // refuse: its call has no result. The card comes back with it, so the call
    // can be answered rather than the chat being stuck.
    const last = chat.messages[chat.messages.length - 1];
    const held = (last?.role === "assistant" ? last.tool_calls : undefined)?.filter(
      (call) => call.type === "function",
    );
    setAwaiting(
      held && held.length > 0
        ? {
            calls: held.map((call) => ({
              id: call.id,
              name: call.function.name,
              arguments: call.function.arguments,
            })),
            history: chat.messages,
          }
        : null,
    );
  }

  // What the open chat is called. A draft answers with the name it will be born
  // with; every other chat takes its title from its row, which a rename rewrites.
  const openTitle = chats.find((chat) => chat.id === chatId)?.title ?? conversationName(messages);

  // What the open chat's answers have cost altogether: the providers' own prices,
  // summed — the transcript's own total, so nothing has to be kept twice.
  const spent = messages.reduce((total, message) => total + (message.usage?.cost ?? 0), 0);

  // A server the open chat calls and nobody can reach is worth saying outright:
  // its tools are simply absent from the request, and an absence is not a reason.
  // A server the chat does not call is the composer's list's to report, not the
  // transcript's — and a lazy server that has not been loaded is outside this
  // too, since none of what it holds is in the request by design: its own row is
  // where its being down is said.
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

  // The tools the open chat's request carries: the pool read from the servers,
  // minus what laziness is holding back, plus the app's own loader while any
  // lazy server is called. It is the answer `requestTools` gives at send time,
  // computed once here, so the JSON view shows the request's tools rather than
  // working them out a second way.
  const sentTools = useMemo(
    () => toolsFor({ servers, chosen, loaded, failed: failures.map((failure) => failure.server) }, tools),
    [servers, chosen, loaded, failures, tools],
  );

  // The lazily imported servers the request will name in its system prompt, in
  // the shape the backend wants them. It is what the JSON view hands back to the
  // backend so the prompt it shows is the prompt that is sent.
  const lazyServers = useMemo(
    () => promptFor({ servers, chosen, loaded, failed: failures.map((failure) => failure.server) }, tools),
    [servers, chosen, loaded, failures, tools],
  );

  // Every change to the open transcript is written out, once — a switch of its
  // servers included, which is why it is part of what is compared rather than
  // something of its own. An empty transcript is a draft: `save_chat` creates the
  // row on the first write and updates it after that, so a draft's servers travel
  // with its first message, there being nothing to hold them before that.
  useEffect(() => {
    if (messages.length === 0) return;
    const written = saved.current;
    if (
      written &&
      written.messages === messages &&
      written.model === model &&
      written.reasoning === reasoning &&
      written.chosen === chosen
    ) {
      return;
    }
    const draft = chatId === null;
    saved.current = { messages, model, reasoning, chosen };
    saving.current = saving.current
      .then(async () => {
        const row = await api.saveChat(draft ? null : chatId, openTitle, model, reasoning, chosen, messages);
        if (draft) setChatId(row.id);
        setChats((all) => [row, ...all.filter((chat) => chat.id !== row.id)]);
      })
      .catch((e) => {
        // Let the next change try again, rather than losing the transcript for
        // good because one write failed.
        saved.current = null;
        fail(e);
      });
  }, [messages, chatId, openTitle, model, reasoning, chosen]);

  // The history, with the most recently written chat reopened: the app comes back
  // the way it was left.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const all = await api.listChats();
        if (!active) return;
        setChats(all);
        const latest = all[0];
        if (!latest) return;
        const chat = await api.loadChat(latest.id);
        if (!active || !chat) return;
        adopt(chat);
      } catch (e) {
        if (active) fail(e);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // A chat's own model, or the head of the list when there is none to inherit: a
  // window opened on a row written before chats had models, and one with no
  // history at all, both still have a model to ask for.
  useEffect(() => {
    if (model !== "" || !config) return;
    setModel(defaultModel(chats, config));
  }, [model, config, chats]);

  /** Asks again for the answer to the prompt at `index`, dropping what followed. */
  const regenerate = useCallback(
    (index: number) => {
      const message = live.current.messages[index];
      if (!message) return;
      // The transcript is about to be rebuilt from that point, so a pending
      // rewrite of some other message no longer refers to anything.
      // The prompt goes back exactly as it was sent — images included — since
      // the answer is being asked again, not the question rewritten.
      setEditing(null);
      turn.send(message.content ?? "", live.current.messages.slice(0, index));
    },
    [turn.send],
  );

  /** Hands the prompt at `index` to the composer to be rewritten. */
  const startEdit = useCallback((index: number) => {
    const message = live.current.messages[index];
    if (!message) return;
    setEditing({ index, text: contentText(message.content) });
  }, []);

  /**
   * The composer's send. While a prompt is being rewritten the transcript is cut
   * back to it first, so the chat starts over from the edited message and
   * everything it had answered is dropped. The images attached to the draft
   * ride with it.
   */
  function submit(text: string, images: string[]) {
    if (pending || !config) return;
    const base = editing === null ? undefined : messages.slice(0, editing.index);
    setEditing(null);
    turn.send(userContent(text, images), base);
  }

  /**
   * New Chat: a draft, with no row of its own until the first message. Refused
   * while a response is in flight, so the stream and the transcript cannot
   * disagree about which chat is being written to.
   */
  const newChat = useCallback(() => {
    if (live.current.pending) return;
    // A new chat is the chat's own pane, whatever the window was showing.
    onLeaveMode();
    saved.current = null;
    setChatId(null);
    setMessages([]);
    setEditing(null);
    setError("");
    // A new chat has no calls waiting on anything.
    setAwaiting(null);
    // A new chat takes up the model, the reasoning level and the servers last
    // used, or the head of the list, no level, and every server.
    setModel(defaultModel(live.current.chats, live.current.config));
    setReasoning(asReasoningLevel(live.current.chats[0]?.reasoning ?? ""));
    setChosen(live.current.chosen);
    // A new chat takes up the servers last used, but not what they had loaded:
    // what is imported lazily is imported for the conversation that asked.
    setLoadedBoth([]);
    // The draft is the composer's, and it survives; the caret is what a new
    // chat is for, so the request can be typed without reaching for the mouse.
    composerRef.current?.focus();
  }, [onLeaveMode]);

  /** Opens a chat from the history. */
  async function openChat(id: number) {
    // Opening a chat from the history is leaving whatever else was in the pane.
    onLeaveMode();
    if (live.current.pending || id === chatId) return;
    try {
      const chat = await api.loadChat(id);
      if (!chat) {
        // Deleted while it was listed; drop the row and say so.
        setChats((all) => all.filter((row) => row.id !== id));
        setError("That chat is gone.");
        return;
      }
      adopt(chat);
      setModel(chat.model || live.current.config?.models[0] || "");
      setEditing(null);
      setFollow(true);
      setError("");
    } catch (e) {
      fail(e);
    }
  }

  async function renameChat(id: number, title: string) {
    try {
      await api.renameChat(id, title);
      setChats((all) => all.map((chat) => (chat.id === id ? { ...chat, title } : chat)));
    } catch (e) {
      fail(e);
    }
  }

  async function deleteChat(id: number) {
    if (live.current.pending) return;
    try {
      await api.deleteChat(id);
      setChats((all) => all.filter((chat) => chat.id !== id));
      // The deleted chat leaves a fresh draft behind rather than an empty screen.
      if (id === chatId) newChat();
    } catch (e) {
      fail(e);
    }
  }

  return {
    messages,
    pending,
    awaiting,
    editing,
    setEditing,
    chats,
    chatId,
    model,
    setModel,
    reasoning,
    setReasoning,
    chosen,
    setChosen,
    loaded,
    spent,
    unreachable,
    sentTools,
    lazyServers,
    submit,
    stop: turn.stop,
    allow: turn.allow,
    decline: turn.decline,
    regenerate,
    startEdit,
    newChat,
    openChat,
    renameChat,
    deleteChat,
  };
}
