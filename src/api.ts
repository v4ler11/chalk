/**
 * The backend's commands, typed.
 *
 * Every call into Rust goes through here, so a command's name and the shape of
 * its arguments are written once and the two windows cannot drift from the
 * contract in `src-tauri/src/lib.rs`. Arguments are named as the commands
 * declare them (`onEvent`, `model`, …); Tauri maps them onto the Rust
 * parameters.
 */
import { invoke, type Channel } from "@tauri-apps/api/core";
import type {
  AppConfig,
  ChatRecord,
  ChatSummary,
  LazyServer,
  McpCallResult,
  McpReport,
  McpServer,
  McpTool,
  McpTools,
  StreamEvent,
  UiMessage,
} from "./types";
import type { LogEntry } from "./logs";

export const getConfig = () => invoke<AppConfig>("get_config");
export const saveConfig = (config: AppConfig) => invoke<AppConfig>("save_config", { config });

export const listChats = () => invoke<ChatSummary[]>("list_chats");
export const loadChat = (id: number) => invoke<ChatRecord | null>("load_chat", { id });
export const saveChat = (
  id: number | null,
  title: string,
  model: string,
  reasoning: string,
  servers: string[] | null,
  messages: UiMessage[],
) => invoke<ChatSummary>("save_chat", { id, title, model, reasoning, servers, messages });
export const renameChat = (id: number, title: string) => invoke<void>("rename_chat", { id, title });
export const deleteChat = (id: number) => invoke<void>("delete_chat", { id });

/**
 * Starts one completion; the stream comes back on `onEvent`.
 *
 * `tools` is what this turn offers the model — the loader among them while the
 * chat still has a lazy server to load — and `lazy` is the ones it has not
 * loaded, which the backend names in the system prompt and does nothing else
 * with.
 */
export const startChat = (
  messages: UiMessage[],
  model: string,
  reasoning: string,
  tools: McpTool[],
  lazy: LazyServer[],
  onEvent: Channel<StreamEvent>,
) => invoke<void>("chat", { messages, model, reasoning, tools, lazy, onEvent });
export const stopStream = () => invoke<void>("stop_stream");

/**
 * The transcript as the request would carry it: the system prompt resolved and
 * put in front of it, and the lazily imported servers named under it. It is the
 * backend's own assembly of the request, and the only place the JSON view gets
 * it — the window's transcript is not what the model is sent.
 */
export const requestPreview = (messages: UiMessage[], lazy: LazyServer[]) =>
  invoke<UiMessage[]>("request_preview", { messages, lazy });

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
/** Calls one tool, named as the request named it; `args` is its JSON text. */
export const mcpCall = (name: string, args: string) =>
  invoke<McpCallResult>("mcp_call", { name, args });

export const openLogs = () => invoke<void>("open_logs");
export const getLogs = () => invoke<LogEntry[]>("get_logs");
