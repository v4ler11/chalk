import { useCallback, useEffect, useRef, useState } from "react";
import { Channel } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  asReasoningLevel,
  contentText,
  userContent,
  type AppConfig,
  type ChatRecord,
  type ChatSummary,
  type Content,
  type McpCost,
  type McpFailure,
  type McpServer,
  type McpTool,
  type Pending,
  type ReasoningLevel,
  type StreamEvent,
  type ToolCallRequest,
  type UiMessage,
} from "./types";
import * as api from "./api";
import { mod } from "./keybinds";
import { MessageList } from "./components/MessageList";
import { ChatNav } from "./components/ChatNav";
import { Composer } from "./components/Composer";
import { offeredServers } from "./components/ServersMenu";
import { LOAD_TOOL_NAME, loadable, promptFor, toolsFor, waiting, withLoaded } from "./lazy";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { ToolApproval } from "./components/ToolApproval";
import "./App.css";

/**
 * The name a chat is born with: its first prompt, collapsed to one line and cut
 * to something the sidebar's row can hold. It only ever seeds a title — once a
 * chat has one, its row owns it.
 */
function conversationName(messages: UiMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  const text = (first ? contentText(first.content) : "").replace(/\s+/g, " ").trim();
  if (text === "") return "New chat";
  return text.length > 42 ? `${text.slice(0, 41)}…` : text;
}

/**
 * The model a chat starts from: the one the most recently written chat was
 * holding, and the head of the settings' list once the history has nothing to
 * say — which is also what a row written before chats had models falls back to.
 */
function defaultModel(chats: ChatSummary[], config: AppConfig | null): string {
  return chats[0]?.model || config?.models[0] || "";
}

/**
 * How many times one turn may ask for tools before it is stopped.
 *
 * A model that will not stop asking would otherwise be answered forever, and the
 * transcript — and the user's tokens — are what pay for it. An honest turn never
 * reaches this; reaching it is a model stuck in a loop.
 */
const MAX_ROUNDS = 8;

/** What a tool call the user declined is answered with. */
const DECLINED = "The user declined to run this tool.";

/** What a call is answered with when the turn was stopped for asking too often. */
const TOO_MANY = "One turn asked for tools too many times, so this was not run.";

/**
 * The message one tool call is answered with, which is what the model reads next.
 *
 * A tool's own failure and the user's refusal travel as this text: the chat
 * completions shape has no error flag for a result, so what happened is what the
 * message says.
 */
function toolMessage(call: ToolCallRequest, text: string, ms?: number): UiMessage {
  return { role: "tool", tool_call_id: call.id, name: call.name, content: text, ms };
}

/**
 * The name a `load_lazy_mcp` call asks for, out of the JSON arguments the model
 * wrote. Anything that is not an object carrying a name is no name at all, which
 * the loader says back rather than guessing at.
 */
function wantedName(args: string): string {
  try {
    const parsed: unknown = JSON.parse(args);
    const name = (parsed as { name?: unknown } | null)?.name;
    return typeof name === "string" ? name : "";
  } catch {
    return "";
  }
}

/** What one round of a turn produced: the message committed for its answer, and
 *  the tool calls that answer asked for. */
interface Round {
  calls: ToolCallRequest[];
  message: UiMessage | null;
}

function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Whether the transcript follows new content. Stays on unless the user scrolls
  // up, and comes back when they reach the bottom, send, or press the arrow.
  const [follow, setFollow] = useState(true);
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
  // Every enabled model context protocol server's tools, as last read: the pool
  // the open chat's own choice is taken from, and what the composer's list
  // counts. Read once, and again after a save, since reading them starts
  // servers — the first read is what pays for that.
  const [tools, setTools] = useState<McpTool[]>([]);
  // The servers as `mcp.json` declares them, so the composer's list is the one
  // the settings window edits — a server that offers nothing, or nothing any
  // more, included.
  const [servers, setServers] = useState<McpServer[]>([]);
  // The servers that could not be reached when the tools were read, and what
  // they said. Kept beside the tools rather than raised as a chat error: a
  // server that is not answering is a fact about that server.
  const [failures, setFailures] = useState<McpFailure[]>([]);
  // What each server's tools cost a request, read with the tools themselves:
  // the composer's list counts a server and prices it from the same read.
  const [costs, setCosts] = useState<McpCost[]>([]);
  // A read is in flight, which the composer's list shows and its Refresh asks
  // for.
  const [reading, setReading] = useState(false);
  // The servers the open chat is sent with, and `null` while it has never
  // chosen — then every enabled one. It belongs to the chat the way its model
  // does: saved with it, read back with it, and taken up by the next new chat.
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
  // The calls a server asked to be allowed to run. They are held here, rather
  // than acted on, until the user says so: a tool is an action taken on their
  // behalf, and only a server marked to run automatically is spared the asking.
  const [awaiting, setAwaiting] = useState<{ calls: ToolCallRequest[]; history: UiMessage[] } | null>(null);

  // The response in flight; a ref so the channel handler always reads the latest
  // values instead of a stale render closure.
  const acc = useRef<Pending | null>(null);
  // How the round in flight is ended from outside its own stream — a stop
  // aborts the request, and no closing frame follows the abort.
  const ending = useRef<((calls: ToolCallRequest[], message: UiMessage | null) => void) | null>(null);
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
  // The composer's field, so a new chat can hand the caret to it.
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // What the message actions read when they run. They are handed to every
  // message, and a message is memoized so its markdown is not re-parsed on every
  // streaming token, which means those handlers have to keep their identity for
  // the life of the window — so they read the state they need here, at click
  // time, instead of closing over the render that made them.
  const live = useRef({ messages, pending, config, chats, model, reasoning, servers, tools, chosen, failures });
  useEffect(() => {
    live.current = { messages, pending, config, chats, model, reasoning, servers, tools, chosen, failures };
  });

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
   * a turn loads a server in the middle of itself: the very next round is the
   * one that has to carry the tools the load just brought in.
   */
  function requestTools(): McpTool[] {
    return toolsFor(lazyState(), live.current.tools);
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
  // of the window: a chat opened again afterwards is the chat it was, and a new
  // chat is a chat that has asked for nothing.
  useEffect(() => {
    lazyByChat.current.set(chatId, loaded);
  }, [chatId, loaded]);

  /** Reports a backend failure without letting it escape the callback. */
  function fail(e: unknown) {
    setError(String(e));
  }

  /** Re-reads the config, which the settings window rewrites in place. */
  function loadConfig() {
    api.getConfig().then(setConfig).catch(fail);
  }

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
    const waiting = (last?.role === "assistant" ? last.tool_calls : undefined)?.filter(
      (call) => call.type === "function",
    );
    setAwaiting(
      waiting && waiting.length > 0
        ? {
            calls: waiting.map((call) => ({
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
  const openTitle =
    chats.find((chat) => chat.id === chatId)?.title ?? conversationName(messages);

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

  useEffect(loadConfig, []);

  /**
   * The servers and their tools, read on the way in and again whenever the
   * settings window saves a change. They are read here rather than per request
   * because reading them starts servers: the first read is what pays for that,
   * and every request after it is sent with what it found.
   *
   * `refresh` starts the connections over first, which is what the composer's
   * list presses for: a server says what it offers when it is connected to, so
   * asking it again means connecting again.
   */
  const readTools = useCallback(async (refresh = false) => {
    setReading(true);
    try {
      const [declared, found] = await Promise.all([api.mcpServers(), api.mcpTools(refresh)]);
      setServers(declared);
      setTools(found.tools);
      setFailures(found.failures);
      setCosts(found.costs);
    } catch (e) {
      fail(e);
    } finally {
      setReading(false);
    }
  }, []);

  useEffect(() => {
    readTools();

    let gone = false;
    let unlisten: (() => void) | undefined;
    listen("servers-changed", () => readTools()).then((fn) => {
      if (gone) fn();
      else unlisten = fn;
    });
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [readTools]);

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

  // The config is edited in the settings window, so this one re-reads it.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    listen("config-changed", loadConfig).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  /**
   * Ends the in-flight response, committing whatever arrived as a message, and
   * answers with the message it committed — `null` when there was nothing to
   * commit, which is how a response stopped before it began reads.
   *
   * The calls are the answer's own. An answer that only asked for tools is a
   * message with no text, so it is committed for its calls rather than skipped
   * for its emptiness: the request that follows carries it, and an unanswered
   * call would leave the transcript one the provider refuses.
   */
  function commit(content?: string, calls: ToolCallRequest[] = []): UiMessage | null {
    const p = acc.current;
    if (!p) return null;
    const endedAt = Date.now();
    const firstTokenAt = p.firstTokenAt ?? endedAt;
    acc.current = null;
    setPending(null);
    // A response stopped before anything arrived leaves nothing to show.
    if (content === undefined && p.answer === "" && p.reasoning === "" && calls.length === 0) return null;
    const text = content ?? p.answer;
    const message: UiMessage = {
      role: "assistant",
      // Text-less is how an answer that only calls tools is written; an empty
      // string would be a different thing said.
      content: text === "" && calls.length > 0 ? undefined : text,
      reasoning: p.reasoning === "" ? undefined : p.reasoning,
      // The wait is the model's silence before its first token; the thinking
      // runs from there to the answer, or to the end if it never answered.
      waitMs: firstTokenAt - p.startedAt,
      thinkingMs: p.thinkingMs ?? endedAt - firstTokenAt,
      // What the provider said the response used, for the answer's own tip.
      usage: p.usage ?? undefined,
      tool_calls:
        calls.length === 0
          ? undefined
          : calls.map((call) => ({
              type: "function" as const,
              id: call.id,
              function: { name: call.name, arguments: call.arguments },
            })),
    };
    setMessages((m) => [...m, message]);
    return message;
  }

  /**
   * One round trip to the model: the transcript in, streamed into the window,
   * and the answer it produced — the message that was committed for it, and the
   * tool calls it asked for, if any.
   *
   * It answers when the round is over, which is why the channel handler calls
   * back into it rather than ending the conversation: what a model asks for is
   * only known once its answer is complete, and a call acted on before then
   * would be acted on half-written. The message comes back with the calls
   * because the transcript the next round is sent has to carry it: a tool's
   * result answers a call, and the call is in that message.
   */
  const round = useCallback(async (request: UiMessage[]): Promise<Round> => {
    setMessages(request);
    const started: Pending = {
      startedAt: Date.now(),
      firstTokenAt: null,
      reasoning: "",
      answer: "",
      thinking: true,
      thinkingMs: null,
      usage: null,
      toolCalls: null,
    };
    acc.current = started;
    setPending(started);

    return await new Promise<Round>((resolve) => {
      // A stop aborts the stream without a closing frame, so the round is ended
      // by hand as well: nothing else would tell the caller it is over.
      const end = (calls: ToolCallRequest[], message: UiMessage | null) => {
        ending.current = null;
        resolve({ calls, message });
      };
      ending.current = end;

      const onEvent = new Channel<StreamEvent>();
      onEvent.onmessage = (ev) => {
        const p = acc.current;
        if (!p) return;
        // The tokens and the price ride the stream's last frame. They are kept for
        // the message this answer becomes, and must not fall through to the commit
        // branch below — nothing displays them while the answer is arriving.
        if (ev.type === "usage") {
          p.usage = ev.usage;
          return;
        }
        if (ev.type === "reasoning") {
          if (p.firstTokenAt == null) {
            // The wait is over: whatever the model sends first ends it.
            p.firstTokenAt = Date.now();
          }
          p.reasoning += ev.content;
        } else if (ev.type === "delta") {
          if (p.thinking) {
            // The first answer token ends the thinking phase; freeze its timer.
            const at = Date.now();
            p.firstTokenAt ??= at;
            p.thinking = false;
            p.thinkingMs = at - p.firstTokenAt;
          }
          p.answer += ev.content;
        } else if (ev.type === "tool_calls") {
          // The calls arrive whole, at the end of the answer: the stream
          // reassembles the fragments the provider sent.
          p.toolCalls = ev.calls;
        } else if (ev.type === "error") {
          // A failed request ends the round as much as a finished one does, with
          // the failure committed in the answer's place.
          end([], commit(`Error: ${ev.message}`));
          return;
        } else {
          // `done`: the answer is complete, and so are the calls it asked for.
          const calls = p.toolCalls ?? [];
          end(calls, commit(undefined, calls));
          return;
        }
        setPending({ ...p });
      };

      api
        .startChat(
          request,
          live.current.model,
          live.current.reasoning,
          requestTools(),
          promptFor(lazyState(), live.current.tools),
          onEvent,
        )
        .catch((e) => {
          // The command itself failed; keep whatever arrived before it.
          end([], commit());
          fail(e);
        });
    });
    // Identity is the point: every message takes the handlers as props, and a
    // new closure per render would re-render — and re-parse — the transcript on
    // every token, which is what the memo on ChatMessage exists to avoid.
  }, []);

  /** Runs one tool call and answers with what the model is told it did. */
  async function callTool(call: ToolCallRequest): Promise<UiMessage> {
    // The loader is the app's own tool rather than a server's, so it is answered
    // here: no server is reached, and what changes is this chat's own state.
    if (call.name === LOAD_TOOL_NAME) return await loadTool(call);
    try {
      const answer = await api.mcpCall(call.name, call.arguments);
      // An empty answer is still an answer — the model learns the tool ran —
      // where no message at all would read as a tool that never came back.
      const text = answer.text === "" ? "The tool answered nothing." : answer.text;
      // How long it took is kept with the answer: the row in the transcript says
      // what the call cost, whether it answered, failed, or said nothing.
      return toolMessage(call, answer.isError ? `The tool failed: ${text}` : text, answer.ms);
    } catch (e) {
      return toolMessage(call, `The tool could not be run: ${e}`);
    }
  }

  /**
   * Answers `load_lazy_mcp`: the server it names stops being lazy for this chat,
   * its tools join the next round's, and the model is told which way it went. A
   * name that is not a lazily imported server is said so, rather than answered
   * with a silence that would read as success.
   *
   * Loading is one-way: a server loaded stays loaded for the rest of the thread,
   * so loading one twice is loading it once.
   */
  async function loadTool(call: ToolCallRequest): Promise<UiMessage> {
    const started = Date.now();
    const wanted = wantedName(call.arguments);
    const server = loadable(lazyState(), wanted);
    if (!server) {
      return toolMessage(call, `No lazily imported server is called "${wanted}".`, Date.now() - started);
    }
    setLoadedBoth(withLoaded(loadedNow.current, server.id));
    return toolMessage(
      call,
      `The ${server.name} server is loaded. Its tools can be called from now on.`,
      Date.now() - started,
    );
  }

  /**
   * Follows one transcript to the end of the turn: the model is asked, and every
   * tool it asks for is run, answered, and the model asked again — until it
   * answers without asking for one.
   *
   * A call belonging to a server that is not allowed to run automatically is not
   * run here: the turn stops with the calls on screen, and the user decides. The
   * round cap is for a model that will not stop asking: an honest turn never
   * reaches it, and the calls of the last round are answered anyway, so the
   * transcript stays one the provider accepts.
   */
  const runTurn = useCallback(async (request: UiMessage[]) => {
    let history = request;
    for (let pass = 0; ; pass++) {
      const { calls, message } = await round(history);
      if (calls.length === 0) return;
      // The answer that asked for the calls is part of the transcript they are
      // answered in: a tool's result answers a call, and the call lives there.
      const asked = message ? [...history, message] : history;
      // An unknown tool is not one the user allowed: what the app cannot place
      // in a server's list is asked about like any other.
      const sent = requestTools();
      const allowed = calls.every((call) => sent.find((tool) => tool.name === call.name)?.autoRun === true);
      if (!allowed) {
        setAwaiting({ calls, history: asked });
        return;
      }
      if (pass === MAX_ROUNDS - 1) {
        history = [...asked, ...calls.map((call) => toolMessage(call, TOO_MANY))];
        setMessages(history);
        setError(`One turn asked for tools ${MAX_ROUNDS} times, so it was stopped there.`);
        return;
      }
      history = [...asked, ...(await Promise.all(calls.map(callTool)))];
      setMessages(history);
    }
  }, [round]);

  /**
   * Sends `content` as the next prompt, appended to `base` — the whole
   * transcript, unless a message is being rewritten or answered again, in which
   * case `base` is the part of it that survives and the rest is dropped.
   */
  const send = useCallback(
    async (content: Content, base?: UiMessage[]) => {
      if (live.current.pending || !live.current.config) return;
      // Sending is an explicit request to see the newest message.
      setFollow(true);
      setError("");
      // A turn of its own replaces whatever was waiting to be allowed: the
      // transcript it belonged to is gone from under it.
      setAwaiting(null);
      await runTurn([...(base ?? live.current.messages), { role: "user", content }]);
    },
    [runTurn],
  );

  /** Runs the calls that were waiting, and asks the model again with what they said. */
  const allow = useCallback(async () => {
    const held = awaiting;
    if (!held) return;
    setAwaiting(null);
    const history = [...held.history, ...(await Promise.all(held.calls.map(callTool)))];
    setMessages(history);
    await runTurn(history);
  }, [awaiting, runTurn]);

  /**
   * Answers the calls without running them.
   *
   * A refusal is said rather than done in silence: the model asked for something
   * and is told the user said no, so it can say why it wanted it or answer
   * without it. Every call is answered either way, which is also what keeps the
   * transcript one the provider accepts.
   */
  const decline = useCallback(async () => {
    const held = awaiting;
    if (!held) return;
    setAwaiting(null);
    const history = [...held.history, ...held.calls.map((call) => toolMessage(call, DECLINED))];
    setMessages(history);
    await runTurn(history);
  }, [awaiting, runTurn]);

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
      send(message.content ?? "", live.current.messages.slice(0, index));
    },
    [send],
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
    send(userContent(text, images), base);
  }

  async function stop() {
    if (!acc.current) return;
    // Whatever arrived is committed, and the round is over as far as the caller
    // is concerned: the backend is about to abort the request, and no closing
    // frame will come of it.
    ending.current?.([], commit());
    try {
      await api.stopStream();
    } catch (e) {
      fail(e);
    }
  }

  /**
   * New Chat: a draft, with no row of its own until the first message. Refused
   * while a response is in flight, so the stream and the transcript cannot
   * disagree about which chat is being written to.
   */
  const newChat = useCallback(() => {
    if (live.current.pending) return;
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
  }, []);

  /** Shows, or brings forward, the settings window. */
  const openSettings = useCallback(async () => {
    try {
      await api.openSettings();
    } catch (e) {
      fail(e);
    }
  }, []);

  // The window's shortcuts, beside the buttons that do the same thing: the rail
  // offers two of these and the model chip the third, and there is no menu bar
  // to carry any of them.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!mod(event) || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      } else if (key === "n") {
        event.preventDefault();
        newChat();
      } else if (key === ",") {
        // The command the platform puts on this key, which is where anyone
        // looking for the settings will press.
        event.preventDefault();
        openSettings();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [newChat, openSettings]);

  /** Opens a chat from the history. */
  async function openChat(id: number) {
    if (pending || id === chatId) return;
    try {
      const chat = await api.loadChat(id);
      if (!chat) {
        // Deleted while it was listed; drop the row and say so.
        setChats((all) => all.filter((row) => row.id !== id));
        setError("That chat is gone.");
        return;
      }
      adopt(chat);
      setModel(chat.model || config?.models[0] || "");
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
    if (pending) return;
    try {
      await api.deleteChat(id);
      setChats((all) => all.filter((chat) => chat.id !== id));
      // The deleted chat leaves a fresh draft behind rather than an empty screen.
      if (id === chatId) newChat();
    } catch (e) {
      fail(e);
    }
  }

  return (
    <div className="app">
      <div className="shell">
        {/* The window's chrome floats over whatever is beneath it: the sidebar's
            head while the sidebar is open, the chat panel's own top-left corner
            while it is shut, so the panel keeps the whole window then. */}
        <TitleBar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((o) => !o)}
          onNewChat={newChat}
        />

        <div className={`left${sidebarOpen ? " open" : ""}`}>
          <Sidebar
            open={sidebarOpen}
            chats={chats}
            openId={chatId}
            onOpen={openChat}
            onRename={renameChat}
            onDelete={deleteChat}
            onOpenSettings={openSettings}
          />
        </div>

        <main className="main">
          <ChatNav model={model} models={config?.models ?? []} onPick={setModel} />

          <MessageList
            messages={messages}
            pending={pending}
            error={error || unreachable}
            follow={follow}
            onFollowChange={setFollow}
            canAct={pending === null && config !== null}
            onRegenerate={regenerate}
            onEdit={startEdit}
          />

          <footer className="composer-bar">
            {/* A server's tool calls are what a turn may stop on: the calls are
                shown above the composer until the user allows them or says no. */}
            {awaiting && (
              <ToolApproval calls={awaiting.calls} onRun={allow} onDecline={decline} />
            )}
            <Composer
              textareaRef={composerRef}
              streaming={pending !== null}
              reasoning={reasoning}
              onReasoning={setReasoning}
              spent={spent}
              editingText={editing?.text ?? null}
              onCancelEdit={() => setEditing(null)}
              servers={{
                declared: servers,
                tools,
                failures,
                costs,
                reading,
                chosen,
                loaded,
                onChoose: setChosen,
                onRefresh: () => readTools(true),
              }}
              onSubmit={submit}
              onStop={stop}
            />
          </footer>
        </main>
      </div>
    </div>
  );
}

export default App;
