/**
 * The one piece of a conversation that is neither React's nor the backend's: the
 * model a chat starts from.
 *
 * Everything else that used to live here belongs to the run now. The name a chat
 * is born with, what a tool call is answered with, the name a load call asks for,
 * and the shape of a round are all the backend's — the run makes them, and the
 * window only draws what it is handed. Keeping a second copy of them here would
 * be a second answer to the same question, and the first one to drift.
 */
import type { AppConfig, ChatSummary } from "./types";

/**
 * The model a chat starts from: the one the most recently made chat was holding,
 * and the head of the settings' list once the history has nothing to say — which
 * is also what a row written before chats had models falls back to.
 */
export function defaultModel(chats: ChatSummary[], config: AppConfig | null): string {
  return chats[0]?.model || config?.models[0] || "";
}
