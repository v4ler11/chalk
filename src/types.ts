/**
 * Wire types for the Rust backend contract (`src-tauri/src/types`).
 *
 * `ChatMessage` mirrors the backend `Message`: `role` plus `content` (a string
 * or an array of parts) and the optional message fields the Chat Completions
 * schema allows — tool calls, refusals, and reasoning/thinking.
 */

export interface AppConfig {
  /** `openrouter`, or `custom` — the two the settings' selector offers. */
  provider: string;
  /**
   * Where a custom provider is: the base URL of an OpenAI-compatible API, with
   * `/chat/completions` hung off it. Not read while the provider is OpenRouter,
   * whose endpoint the backend knows.
   */
  endpoint: string;
  apiKey: string;
  /**
   * The models to choose between, in the order the picker shows them. The first
   * is what a chat starts from when the history has nothing to say; a chat then
   * keeps whichever it was given.
   */
  models: string[];
  /**
   * Sent ahead of every chat as a `system` message. It is added to the request
   * on the way out, so it never becomes part of a chat's transcript.
   */
  systemPrompt: string;
}

export type Role = "developer" | "system" | "user" | "assistant" | "tool" | "function";

/**
 * How hard a chat asks the model to think. `""` is off: no level is asked for,
 * so a model that reasons by default still does, and the provider's own idea of
 * how much is left alone.
 */
export type ReasoningLevel = "" | "low" | "medium" | "high";

/**
 * The levels the composer offers, in the order its menu shows them, with the
 * letter each is worn as while it is in force.
 */
export const REASONING_LEVELS: { level: ReasoningLevel; label: string; letter: string }[] = [
  { level: "", label: "Off", letter: "" },
  { level: "low", label: "Low", letter: "L" },
  { level: "medium", label: "Med", letter: "M" },
  { level: "high", label: "High", letter: "H" },
];

/**
 * A level as a row holds it — a string, since the column is one — read as the
 * composer knows it. Anything that is not a level, which is what a database
 * edited by hand may hold, is off.
 */
export function asReasoningLevel(level: string): ReasoningLevel {
  const known = REASONING_LEVELS.find((option) => option.level === level);
  return known ? known.level : "";
}

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "auto" | "low" | "high" } }
  | { type: "input_audio"; input_audio: { data: string; format: string } }
  | { type: "file"; file: { filename?: string; file_data?: string; file_id?: string } }
  | { type: "refusal"; refusal: string };

export type Content = string | ContentPart[];

export interface FunctionCall {
  name: string;
  arguments: string;
}

export interface CustomCall {
  name: string;
  input: string;
}

export type ToolCall =
  | { type: "function"; id: string; function: FunctionCall }
  | { type: "custom"; id: string; custom: CustomCall };

export type ReasoningDetail =
  | { type: "reasoning.summary"; summary: string; id?: string | null; format?: string; index?: number }
  | { type: "reasoning.encrypted"; data: string; id?: string | null; format?: string; index?: number }
  | {
      type: "reasoning.text";
      text: string;
      signature?: string | null;
      id?: string | null;
      format?: string;
      index?: number;
    };

export interface ChatMessage {
  role: Role;
  content?: Content;
  name?: string;
  refusal?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  reasoning?: string;
  reasoning_content?: string;
  reasoning_details?: ReasoningDetail[];
}

/**
 * A tool the model asked for: the call as the stream assembled it, with the
 * arguments still the JSON text the provider sent (fragments arrive split).
 */
export interface ToolCallRequest {
  /** The provider's id for this call, which the result must answer. */
  id: string;
  /** The namespaced tool name, as it was offered in the request. */
  name: string;
  /** The arguments, as JSON text. */
  arguments: string;
}

/**
 * Token counts and price reported for a response. Every field is optional: what
 * arrives depends on the provider, and gateways add the billing fields.
 */
export interface Usage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
    audio_tokens?: number;
    text_tokens?: number;
    image_tokens?: number;
    video_tokens?: number;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    accepted_prediction_tokens?: number;
    rejected_prediction_tokens?: number;
    audio_tokens?: number;
    text_tokens?: number;
    image_tokens?: number;
  };
  /** What the request cost, in USD. */
  cost?: number;
  /** True when the caller's own provider credentials were used. */
  is_byok?: boolean;
  /**
   * The gateway's own word on whether it answered from its cache: `HIT`, when
   * OpenRouter replayed an identical earlier request — free, and with every
   * count above reported as zero — or `MISS`, when the request went on to the
   * model. Absent from a gateway that has no such verdict.
   */
  cache_status?: string;
  cost_details?: {
    upstream_inference_cost?: number;
    upstream_inference_prompt_cost?: number;
    upstream_inference_completions_cost?: number;
  };
}

/**
 * A message as held by the UI: the wire message plus locally measured timings.
 * The timing fields are display-only; the backend ignores unknown keys.
 */
export interface UiMessage extends ChatMessage {
  /**
   * When this prompt was sent, in epoch milliseconds.
   *
   * The window's own field, and the one the request's header is written from:
   * the backend heads every user message with the time it was sent and how long
   * after the previous one, resolved from this. It is kept with the message so
   * that header is the same bytes on every later request — the prefix a
   * provider's prompt cache has to find to be able to reuse any of it.
   */
  sentAt?: number;
  /** Wall-clock ms from sending the request to the model's first token. */
  waitMs?: number;
  /** Wall-clock ms the model spent thinking: from that first token to the answer. */
  thinkingMs?: number;
  /**
   * How long a tool took to answer, in milliseconds. A `tool` message carries
   * it, so a call's row read back from the history still says what it cost —
   * and the backend writes the transcript back whole, so a key it does not know
   * is kept rather than dropped.
   */
  ms?: number;
  /**
   * What the provider reported about the response: the tokens it used, and what
   * it cost. Display-only, like the timings, and absent on an answer written
   * before the app kept them — and on a response that reported none.
   */
  usage?: Usage;
}

/**
 * The assistant response currently arriving, as the run reports it: the answer
 * so far, the reasoning behind it, and the timings the transcript draws. It is
 * the run's own shape, so the window draws a response it did not assemble.
 */
export interface Partial {
  /** Epoch ms the request was sent. */
  startedAt: number;
  /** Epoch ms the first token of any kind arrived; `null` until then. */
  firstTokenAt: number | null;
  /** Thinking text received so far. */
  reasoning: string;
  /** Answer text received so far. */
  answer: string;
  /** True until the first answer token arrives. */
  thinking: boolean;
  /** Frozen thinking duration; `null` while still thinking. */
  thinkingMs: number | null;
  /** What the provider reported about the response; `null` until it says. */
  usage: Usage | null;
}

/** Where a chat's turn stands. `idle` is also where a run that finished sits:
 *  what it did is in the transcript, and how many answers it left there is what
 *  a list counts. */
export type RunStatus = "idle" | "running" | "awaiting" | "failed";

/**
 * What a list needs about a run: whether it is going, whether the model has said
 * anything yet, and whether it is the user's move.
 */
export interface RunSummary {
  chat: number;
  status: RunStatus;
  /**
   * True while the turn is going and no answer token has arrived — a run queued
   * for a place among the requests is thinking, as far as a list is concerned.
   */
  thinking: boolean;
  /**
   * How many messages the thread has said since its prompt: the user's own and
   * the model's answers, with the tools' results left out, which are a record
   * of what was done rather than anything said. What is committed, so it stays
   * still for the whole of a run and moves when the answer lands.
   */
  replies: number;
  /** How many tool calls are waiting on the user. */
  awaiting: number;
}

/**
 * A chat as a window opened on it reads it: the run while there is one, and the
 * row when there is not.
 */
export interface RunSnapshot {
  chat: number;
  status: RunStatus;
  title: string;
  model: string;
  /** The level as the row holds it; `asReasoningLevel` is what reads it back. */
  reasoning: string;
  /**
   * The ids of the servers this chat offers; `null` while it has never chosen,
   * which offers every enabled one.
   */
  servers: string[] | null;
  /** The ids of the servers this run has loaded lazily. */
  loaded: string[];
  /** How many messages the thread has said since its prompt: the user's own and
   *  the model's answers, with the tools' results left out. */
  replies: number;
  /** The transcript: the run's own while it is live, the row's otherwise. */
  messages: UiMessage[];
  /** The answer arriving, or `null` when the run has none in flight. */
  partial: Partial | null;
  /** The calls nobody has answered: the ones a turn stopped on, held until the
   *  user says. */
  awaiting: ToolCallRequest[];
  /** The last failure for this chat, or `null`. */
  error: string | null;
}

/**
 * The request as the model will read it, for the JSON view: the transcript with
 * the system prompt resolved and the lazily imported servers named under it, and
 * the tools the round would offer. It is the run's own assembly, read here
 * rather than worked out a second way in the window.
 */
export interface RequestPreview {
  messages: UiMessage[];
  tools: McpTool[];
  lazy: LazyServer[];
}

/** One row of the chat history list, as the store returns it. */
export interface ChatSummary {
  id: number;
  title: string;
  /** Unix time in ms of the chat's last write, which orders and groups the list. */
  updatedAt: number;
  /** The model this chat is holding; empty on a row written before there was more than one. */
  model: string;
  /**
   * The reasoning level this chat is asking with; empty — off — on a row written
   * before there was a control for it. Held as a string because the column is
   * one; `asReasoningLevel` is what reads it back.
   */
  reasoning: string;
  /**
   * Unix time in ms the chat was created: what the channel's feed is ordered by,
   * since a thread's own row moves under a reply where its place in the feed
   * does not.
   */
  createdAt: number;
  /** The chat's first user message, whole: what the channel's row shows. */
  root: string;
  /** How many messages the chat holds after its opening one, the tools' results
   *  among them left out: the user's own and the model's answers. */
  replies: number;
  /**
   * How many pictures the prompt was posted with. A count rather than the
   * pictures: an attachment is a data URL, and the list is drawn on every post.
   * A row that has any asks for them, by id, when it is drawn.
   */
  images: number;
}

/** Flatten a message's content to display text. */
export function contentText(content?: Content): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" ? part.text : part.type === "refusal" ? part.refusal : ""))
    .join("");
}

/**
 * The content of a user message: the prompt's text, then the images attached to
 * it. Text alone is the common case, and the wire takes that as a bare string.
 */
export function userContent(text: string, images: string[]): Content {
  if (images.length === 0) return text;
  const parts: ContentPart[] = images.map((url) => ({ type: "image_url", image_url: { url } }));
  if (text !== "") parts.unshift({ type: "text", text });
  return parts;
}

/** The images a content carries, in the order it carries them: what a prompt
 *  re-sent as it was — a regenerate — hands back to `run_start` beside it. */
export function imageUrls(content?: Content): string[] {
  if (content == null || typeof content === "string") return [];
  return content.flatMap((part) => (part.type === "image_url" ? [part.image_url.url] : []));
}

/** Flatten a message's reasoning (thinking) to display text, if any. */
export function reasoningText(message: ChatMessage): string {
  if (message.reasoning) return message.reasoning;
  if (message.reasoning_content) return message.reasoning_content;
  return (message.reasoning_details ?? [])
    .map((detail) =>
      detail.type === "reasoning.text"
        ? detail.text
        : detail.type === "reasoning.summary"
          ? detail.summary
          : "",
    )
    .join("");
}

/**
 * How a model context protocol server is reached.
 *
 * `stdio` runs a program and speaks the protocol over its standard streams —
 * one JSON-RPC message per line. `http` posts each message to a URL, the
 * streamable HTTP transport, with whatever headers the server needs.
 */
export type McpTransport =
  | { type: "stdio"; command: string; args: string[]; env: Record<string, string> }
  | { type: "http"; url: string; headers: Record<string, string> };

/** One server, as `mcp.json` holds it and the settings window edits it. */
export interface McpServer {
  /** A unique name for this server, which the tools it offers are named under. */
  id: string;
  /** What the settings window lists it as. */
  name: string;
  enabled: boolean;
  /** Run this server's tools without asking first. */
  autoRun: boolean;
  /** Imported lazily: its tools are offered only once a chat loads it, and the
   *  system prompt carries its name and description until then. */
  lazy: boolean;
  /** What the model is told it is, while it is lazy. */
  description: string;
  transport: McpTransport;
}

/** The reasoning behind a message: what it thought, and how long it waited and
 *  thought to get there. A turn that called tools has several rounds behind it,
 *  and what they all reasoned is read as one of these. */
export interface Thought {
  text: string;
  waitMs: number;
  thinkingMs: number;
}

/** One lazily imported server as the system prompt names it: what it is called,
 *  what it is for, and the names of the tools it is holding back — the names
 *  alone, since it is their definitions the prompt is spared. */
export interface LazyServer {
  name: string;
  description: string;
  tools: string[];
}

/** One tool a configured server offers, named as the request names it. */
export interface McpTool {
  /** The name the model calls: the server's and the tool's, namespaced. */
  name: string;
  /** The id of the server offering it. */
  server: string;
  serverName: string;
  /** What the settings window lists it as: the tool's title, or its name. */
  title: string;
  description: string;
  /** The tool's arguments, as a JSON Schema. */
  parameters: unknown;
  /** Whether the server it belongs to runs its tools without asking. */
  autoRun: boolean;
}

/** What a server answers when it is asked what it offers. */
export interface McpReport {
  /** The protocol revision the client and server agreed on. */
  protocol: string;
  serverName: string;
  serverVersion: string;
  tools: { name: string; title: string; description: string }[];
}

/** One server that could not be reached, and what it said. */
export interface McpFailure {
  /** The id of the server that did not answer. */
  server: string;
  /** What it is called, for a line that has to name it. */
  name: string;
  message: string;
}

/** What one server's tools cost a request, in bytes. */
export interface McpCost {
  /** The id of the server whose tools they are. */
  server: string;
  /** The `tools` array as the endpoint receives it: compact JSON, in UTF-8. */
  bytes: number;
}

/** Every enabled server's tools, and the servers that could not be reached. */
export interface McpTools {
  tools: McpTool[];
  failures: McpFailure[];
  /** What each server's tools cost, so its row can say what it costs. */
  costs: McpCost[];
}

/** What a tool call answered. */
export interface McpCallResult {
  /** The result as text, which is what the model is given back. */
  text: string;
  /** True when the tool reported its own failure. */
  isError: boolean;
  /** The structured result, when the server sent one. */
  structured?: unknown;
  /** How long the call took, in milliseconds. */
  ms: number;
}
