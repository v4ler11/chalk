/**
 * The pieces of a conversation that are not React: how a chat is named, what it
 * starts from, and how a tool call is answered. They are here rather than in the
 * window so the window is about the window.
 */
import { contentText, type AppConfig, type ChatSummary, type ToolCallRequest, type UiMessage } from "./types";

/** What a tool call the user declined is answered with. */
export const DECLINED = "The user declined to run this tool.";

/**
 * The name a chat is born with: its first prompt, collapsed to one line and cut
 * to something the sidebar's row can hold. It only ever seeds a title — once a
 * chat has one, its row owns it.
 */
export function conversationName(messages: UiMessage[]): string {
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
export function defaultModel(chats: ChatSummary[], config: AppConfig | null): string {
  return chats[0]?.model || config?.models[0] || "";
}

/**
 * The message one tool call is answered with, which is what the model reads next.
 *
 * A tool's own failure and the user's refusal travel as this text: the chat
 * completions shape has no error flag for a result, so what happened is what the
 * message says.
 */
export function toolMessage(call: ToolCallRequest, text: string, ms?: number): UiMessage {
  return { role: "tool", tool_call_id: call.id, name: call.name, content: text, ms };
}

/**
 * The name a `load_lazy_mcp` call asks for, out of the JSON arguments the model
 * wrote. Anything that is not an object carrying a name is no name at all, which
 * the loader says back rather than guessing at.
 */
export function wantedName(args: string): string {
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
export interface Round {
  calls: ToolCallRequest[];
  message: UiMessage | null;
}
