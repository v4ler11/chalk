/**
 * The backend's commands, typed.
 *
 * Every call into Rust goes through here, so a command's name and the shape of
 * its arguments are written once and the two windows cannot drift from the
 * contract in `src-tauri/src/lib.rs`. Arguments are named as the commands
 * declare them (`chat`, `keep`, …); Tauri maps them onto the Rust parameters.
 */
import { invoke } from "@tauri-apps/api/core";
import type {
  AppConfig,
  ChatSummary,
  Content,
  McpReport,
  McpServer,
  McpTool,
  McpTools,
  RequestPreview,
  RunSnapshot,
  RunSummary,
} from "./types";
import type { LogEntry } from "./logs";

export const getConfig = () => invoke<AppConfig>("get_config");
export const saveConfig = (config: AppConfig) => invoke<AppConfig>("save_config", { config });

/** The history, most recently written first. */
export const listChats = () => invoke<ChatSummary[]>("list_chats");
/** The pictures a chat's opening prompt was posted with, as the data URLs they
 *  were sent as. Asked for by the rows that have any, when they are drawn. */
export const rootImages = (chat: number) => invoke<string[]>("root_images", { chat });
export const deleteChat = (id: number) => invoke<void>("delete_chat", { id });

/**
 * Pins a thread, or takes the pin off it.
 *
 * A pin is a mark on a thread's own row rather than a row of its own, so the row
 * is not written whole: the pin's column alone is, which is why a pin taken while
 * a thread is answering survives whatever its run writes next.
 */
export const pinChat = (chat: number, pinned: boolean) => invoke<void>("pin_chat", { chat, pinned });

/**
 * The pinned threads, most recently pinned first. A thread is pinned, and a
 * thread is a chat's row, so what comes back is the same summary any other list
 * is drawn from — the pin being one more thing a row says, not a kind of row.
 */
export const listPins = () => invoke<ChatSummary[]>("list_pins");

/**
 * Sends a prompt into a chat, starting its turn in the backend.
 *
 * With no chat named, one is made from the prompt: that is what posting to the
 * channel is, and why there is no New Thread button — the message is the thread.
 * `keep` cuts the transcript to its first so many messages before the prompt is
 * added, which is how editing a prompt and asking again start the turn over from
 * there. `servers` of `null` is a chat that has never chosen, which offers every
 * enabled server. The call answers as soon as the run is going; the answer
 * arrives on the window as `run-delta`.
 *
 * The prompt is a `Content` rather than text plus images: what a message is made
 * of — its words, and the pictures riding with them — is one value, and the parts
 * the window already built are the parts the backend stores.
 */
export const runStart = (
  chat: number | null,
  content: Content,
  model: string,
  reasoning: string,
  servers: string[] | null,
  keep: number | null,
) => invoke<{ chat: number }>("run_start", { chat, content, model, reasoning, servers, keep });

/** Stops a chat's turn: whatever arrived stays as the answer. */
export const runStop = (chat: number) => invoke<void>("run_stop", { chat });
/** Runs the calls that were waiting on the user, and asks the model again. */
export const runAllow = (chat: number) => invoke<void>("run_allow", { chat });
/** Answers the waiting calls without running them. */
export const runDecline = (chat: number) => invoke<void>("run_decline", { chat });

/** One chat as a window opened on it reads it: the run while there is one, the
 *  row when there is not. `null` when the chat is gone. */
export const runState = (chat: number) => invoke<RunSnapshot | null>("run_state", { chat });
/** Every run there is, for a list to draw against. */
export const runsState = () => invoke<RunSummary[]>("runs_state");

/** What a chat is sent with next time. A key that is absent is left as it was,
 *  and a `servers` of `null` is a chat that has never chosen. */
export interface ChatChange {
  model?: string;
  reasoning?: string;
  servers?: string[] | null;
}

/**
 * Changes what a chat is sent with next time. Only the keys that are given are
 * sent, since the backend tells an absent key from one written: `servers: null`
 * means "never chose", which is not the same as leaving the choice alone.
 */
export const chatSet = (chat: number, change: ChatChange) => {
  const args: Record<string, unknown> = { chat };
  if (change.model !== undefined) args.model = change.model;
  if (change.reasoning !== undefined) args.reasoning = change.reasoning;
  if (change.servers !== undefined) args.servers = change.servers;
  return invoke<void>("chat_set", args);
};

/**
 * The request as the model will read it: the transcript with the system prompt
 * resolved and the lazily imported servers named under it, and the tools the
 * round would offer. It is the backend's own assembly, and the only place the
 * JSON view gets it — the window's transcript is not what the model is sent.
 */
export const requestPreview = (chat: number) => invoke<RequestPreview>("request_preview", { chat });

/** The model context protocol servers, as `mcp.json` holds them. */
export const mcpServers = () => invoke<McpServer[]>("mcp_servers");
/** Writes the servers back to `mcp.json`, and answers with what was written. */
export const mcpSaveServers = (servers: McpServer[]) =>
  invoke<McpServer[]>("mcp_save_servers", { servers });
/** Connects to one server and asks what it offers, without keeping it. */
export const mcpTest = (server: McpServer) => invoke<McpReport>("mcp_test", { server });
/**
 * Every enabled server's tools, and the servers that could not be reached.
 *
 * `refresh` starts the connections over first, which is what asking a server
 * what it offers a second time costs: the listing is read when it is connected
 * to, so a server that has grown a tool since is only seen by reconnecting.
 */
export const mcpTools = (refresh = false) => invoke<McpTools>("mcp_tools", { refresh });

/**
 * The app's own tools: the ones that manage its settings and its servers rather
 * than a server's own. They are in every request rather than a chat's choice, so
 * the window asks for them once — and they come from the backend, beside the
 * code that answers them, so a tool the model is offered and the code that runs
 * it cannot drift apart.
 */
export const manageTools = () => invoke<McpTool[]>("manage_tools");

export const openLogs = () => invoke<void>("open_logs");
export const getLogs = () => invoke<LogEntry[]>("get_logs");
