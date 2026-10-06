import type { ChatSummary, RunStatus } from "./types";
import type { RunEntry } from "./runs";

/**
 * One thread as the feed draws it: the root message that opened it, and, under
 * it, one quiet line about where the thread stands. The row is a chat's own
 * summary plus what its run is doing, so the shape carries both what the list
 * says about a chat and what the run says about the run.
 */
export type ChannelRow = {
  /** The chat the row opens. */
  chat: number;
  /** The message that opened the thread, as it was typed. */
  root: string;
  /** Unix time in ms the thread was opened, which orders the feed. */
  createdAt: number;
  /** How many messages the thread holds after its opening one. */
  replies: number;
  /** How many of those the user wrote, the prompt that opened the thread not
   *  among them: it is what says whether they are a participant in it. */
  mine: number;
  /** How many pictures the prompt was posted with, which is what the row asks
   *  for them by: none is a row that has nothing to draw. */
  images: number;
  /** The model this thread is with: who answered it, as its circle is drawn. */
  model: string;
  /** Unix time in ms of the thread's last message, which is when it was last
   *  answered — what the row says under the count of what was said. */
  updatedAt: number;
  status: RunStatus;
  /** True while the run has not answered yet: it is thinking, not answering. */
  thinking: boolean;
  /** The calls the run is holding for the user. */
  awaiting: number;
  /** Whether this thread is the one on screen. */
  active: boolean;
};

/**
 * Where one chat's run stands, as the feed reads it.
 *
 * The phase comes from `status` and `thinking`, never from `replies`, which stays
 * still for the whole of a run and only moves when the answer lands.
 *
 * What the row says about the thread's own messages — how many were said, and how
 * many of those the user said — is read from the run wherever there is one, and
 * from the chat list only for a chat no run knows about. The two are read
 * together for a reason: the list is read when the feed is built and not again
 * for every message a thread takes, so a row that took its count from the run and
 * its participant count from the list would answer the same question twice and
 * disagree with itself — a thread where the user had answered, still drawn as
 * theirs alone.
 */
export function phase(
  run: RunEntry | undefined,
  chat: ChatSummary,
): { status: RunStatus; thinking: boolean; awaiting: number; replies: number; mine: number } {
  if (run?.kind === "snapshot") {
    const snapshot = run.snapshot;
    return {
      status: snapshot.status,
      // A run that has not answered yet is thinking, whether or not the model has
      // reasoned anything: the empty partial is the moment between the request
      // going out and the first token coming back.
      thinking: snapshot.status === "running" && (snapshot.partial === null || snapshot.partial.thinking),
      awaiting: snapshot.awaiting.length,
      replies: snapshot.replies,
      mine: snapshot.mine,
    };
  }
  if (run?.kind === "summary") {
    return {
      status: run.summary.status,
      thinking: run.summary.thinking,
      awaiting: run.summary.awaiting,
      replies: run.summary.replies,
      mine: run.summary.mine,
    };
  }
  return { status: "idle", thinking: false, awaiting: 0, replies: chat.replies, mine: chat.mine };
}

/**
 * The feed, oldest first: every thread's root message with its run's phase, and
 * one of them marked as the thread on screen.
 */
export function buildRows(
  chats: ChatSummary[],
  runs: ReadonlyMap<number, RunEntry>,
  thread: number | null,
): ChannelRow[] {
  return [...chats]
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((chat) => ({
      chat: chat.id,
      root: chat.root,
      createdAt: chat.createdAt,
      images: chat.images,
      model: chat.model,
      updatedAt: chat.updatedAt,
      active: thread === chat.id,
      ...phase(runs.get(chat.id), chat),
    }));
}
