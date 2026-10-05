import { useCallback, useRef, type Dispatch, type RefObject, type SetStateAction } from "react";
import { Channel } from "@tauri-apps/api/core";
import type {
  AppConfig,
  ChatSummary,
  Content,
  LazyServer,
  McpFailure,
  McpServer,
  McpTool,
  Pending,
  ReasoningLevel,
  StreamEvent,
  ToolCallRequest,
  UiMessage,
} from "./types";
import * as api from "./api";
import { LOAD_TOOL_NAME } from "./lazy";
import { DECLINED, toolMessage, wantedName, type Round } from "./conversation";

/** The conversation as a turn reads it: the open transcript, the model and the
 *  reasoning level it is asked with, and the servers it is sent with. Held by
 *  identity in a ref, so a turn reads the latest values rather than the render
 *  that made its callbacks. */
export interface LiveState {
  messages: UiMessage[];
  pending: Pending | null;
  config: AppConfig | null;
  chats: ChatSummary[];
  model: string;
  reasoning: ReasoningLevel;
  servers: McpServer[];
  tools: McpTool[];
  chosen: string[] | null;
  failures: McpFailure[];
}

interface Options {
  setMessages: Dispatch<SetStateAction<UiMessage[]>>;
  setPending: Dispatch<SetStateAction<Pending | null>>;
  setAwaiting: Dispatch<SetStateAction<{ calls: ToolCallRequest[]; history: UiMessage[] } | null>>;
  setError: (message: string) => void;
  /** Sending is an explicit wish to see the newest message. */
  setFollow: (follow: boolean) => void;
  /** The conversation as it is at the moment a turn needs it. */
  live: RefObject<LiveState>;
  /** The calls a server asked to run, waiting on the user. */
  awaiting: { calls: ToolCallRequest[]; history: UiMessage[] } | null;
  /** The tools a request is sent right now: the chat's servers' tools, with the
   *  lazy ones held back until this chat has loaded them. */
  requestTools: () => McpTool[];
  /** The lazily imported servers the request names in its system prompt. */
  lazyPrompt: () => LazyServer[];
  /** The server a load call names, of those this chat may load; `null` when it
   *  names none. */
  loadableServer: (wanted: string) => McpServer | null;
  /** Marks a server loaded for this chat — in the ref first, since the round
   *  that follows reads it there, and in the state so the window draws it. */
  loadedWith: (id: string) => void;
}

/**
 * The turn: one round trip to the model, streamed into the window, and the loop
 * that runs the tools it asks for and asks again until it answers without one.
 *
 * Everything a turn needs mid-flight — the model, the reasoning level, the tools
 * of the next round — is read from the live state rather than taken from a
 * render, because a load happens inside a turn and the very next round is the
 * one that has to carry what it brought in. Its callbacks keep their identity
 * for the life of the window, since the transcript's own handlers do.
 */
export function useTurn({
  setMessages,
  setPending,
  setAwaiting,
  setError,
  setFollow,
  live,
  awaiting,
  requestTools,
  lazyPrompt,
  loadableServer,
  loadedWith,
}: Options) {
  // The response in flight; a ref so the channel handler always reads the latest
  // values instead of a stale render closure.
  const acc = useRef<Pending | null>(null);
  // How the round in flight is ended from outside its own stream — a stop aborts
  // the request, and no closing frame follows the abort.
  const ending = useRef<((calls: ToolCallRequest[], message: UiMessage | null) => void) | null>(null);
  // The things a turn reads from the conversation, held by identity: the turn's
  // callbacks are made once, so they cannot close over a render's values.
  const deps = useRef({ requestTools, lazyPrompt, loadableServer, loadedWith });
  deps.current = { requestTools, lazyPrompt, loadableServer, loadedWith };

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

      const { model, reasoning } = live.current;
      api
        .startChat(request, model, reasoning, deps.current.requestTools(), deps.current.lazyPrompt(), onEvent)
        .catch((e) => {
          // The command itself failed; keep whatever arrived before it.
          end([], commit());
          setError(String(e));
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
    const server = deps.current.loadableServer(wanted);
    if (!server) {
      return toolMessage(call, `No lazily imported server is called "${wanted}".`, Date.now() - started);
    }
    deps.current.loadedWith(server.id);
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
   * run here: the turn stops with the calls on screen, and the user decides.
   * There is no round cap: how many times a turn may ask is the model's business
   * and the user's, who can see every round on screen and stop the turn, where a
   * number picked here would cut off an honest turn that simply had more work to
   * do. A model that asks forever is visible, and stopped by hand.
   */
  const runTurn = useCallback(async (request: UiMessage[]) => {
    let history = request;
    for (;;) {
      const { calls, message } = await round(history);
      if (calls.length === 0) return;
      // The answer that asked for the calls is part of the transcript they are
      // answered in: a tool's result answers a call, and the call lives there.
      const asked = message ? [...history, message] : history;
      // An unknown tool is not one the user allowed: what the app cannot place
      // in a server's list is asked about like any other.
      const sent = deps.current.requestTools();
      const allowed = calls.every((call) => sent.find((tool) => tool.name === call.name)?.autoRun === true);
      if (!allowed) {
        setAwaiting({ calls, history: asked });
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
      // When the prompt was sent. It is kept with the message so the header the
      // request carries on it is the same bytes on every later request — which
      // is the only way a provider's prompt cache can find the prefix again.
      await runTurn([...(base ?? live.current.messages), { role: "user", content, sentAt: Date.now() }]);
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

  /** Stops the response in flight, committing what has arrived so far. */
  async function stop() {
    if (!acc.current) return;
    // Whatever arrived is committed, and the round is over as far as the caller
    // is concerned: the backend is about to abort the request, and no closing
    // frame will come of it.
    ending.current?.([], commit());
    try {
      await api.stopStream();
    } catch (e) {
      setError(String(e));
    }
  }

  return { send, allow, decline, stop };
}
