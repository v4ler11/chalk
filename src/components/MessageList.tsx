import { Fragment, useLayoutEffect, useMemo, useRef } from "react";
import { contentText, reasoningText, type Partial, type Thought, type UiMessage } from "../types";
import { useFollowEnd } from "../useFollowEnd";
import { ChatMessage } from "./ChatMessage";
import { StreamingMessage } from "./StreamingMessage";
import { ToBottom } from "./ToBottom";

/**
 * While an answer arrives the transcript is held at its own end: the newest line
 * is the last one on screen, and the view never sits a viewport above it. The
 * moment the reader moves the view away, it is theirs — that is what reading
 * looks like — and the ↓ button on the transcript's edge hands it back.
 *
 * The pin itself is `useFollowEnd`, which the feed uses too. What is here is what
 * the transcript has to say to it: which of its renders grew it, whether a
 * growth is a claim on the view, and what the transcript draws.
 */

interface Props {
  messages: UiMessage[];
  /** What the app calls the person whose prompts these are: the name and the
   *  mark every one of their messages is headed with. */
  author: string;
  /** The response currently arriving, if any. */
  pending: Partial | null;
  error: string;
  /** Whether the view follows new content; false once the reader moves away. */
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  /** Whether a prompt's actions are offered; false while a response is arriving. */
  canAct: boolean;
  onRegenerate: (index: number) => void;
  onEdit: (index: number) => void;
}

export function MessageList({
  messages,
  author,
  pending,
  error,
  follow,
  onFollowChange,
  canAct,
  onRegenerate,
  onEdit,
}: Props) {
  const scrollRef = useRef<HTMLElement>(null);
  const pin = useFollowEnd({ ref: scrollRef, follow, onFollowChange });
  /** The transcript as the last pass saw it: how many messages, and whether an
      answer was arriving then. A message that arrives with none arriving is new
      to the reader, whoever put it there, and brings the view back. */
  const seen = useRef({ count: messages.length, streaming: pending !== null });

  /**
   * What each call was answered with. A tool message answers the call whose id
   * it carries, and the two are one row of the transcript — drawn by the message
   * that asked, since that is where the call's name and its arguments are
   * written. Built in one pass over the transcript, which changes only when a
   * round is committed.
   */
  const pairing = useMemo(() => {
    const answers = new Map<string, UiMessage>();
    const asked = new Set<string>();
    for (const message of messages) {
      if (message.role === "assistant") {
        for (const call of message.tool_calls ?? []) asked.add(call.id);
      } else if (message.role === "tool" && message.tool_call_id) {
        answers.set(message.tool_call_id, message);
      }
    }
    return { answers, asked };
  }, [messages]);

  /**
   * What each message shows of the reasoning behind it, gathered over a turn.
   *
   * A turn that calls tools goes round: every round is an assistant message of
   * its own, carrying whatever it reasoned and however long it waited. Read one
   * at a time that is the same heading three times over, so the rounds are
   * carried into the message that answers for them — the one that has something
   * to say, or, when none has, the last of them, so a turn stopped at a call
   * still shows what it thought. The timers are summed, since between them they
   * are what the turn took, and a round that only asked for tools is left
   * showing its call rows and nothing above them.
   */
  const thought = useMemo(() => {
    const out = new Map<UiMessage, Thought>();
    let said: string[] = [];
    let waitMs = 0;
    let thinkingMs = 0;
    let timed = false;
    let held: UiMessage[] = [];

    const carry = (message: UiMessage) => {
      const reasoned = reasoningText(message);
      if (reasoned !== "") said.push(reasoned);
      // A message written before the app timed anything has no wait at all,
      // which is not the same as one that waited no time.
      if (message.waitMs != null) {
        timed = true;
        waitMs += message.waitMs;
        thinkingMs += message.thinkingMs ?? 0;
      }
      held.push(message);
    };

    const settle = (on: UiMessage) => {
      if (timed || said.length > 0) {
        out.set(on, { text: said.join("\n\n"), waitMs, thinkingMs });
      }
      said = [];
      waitMs = 0;
      thinkingMs = 0;
      timed = false;
      held = [];
    };

    for (const message of messages) {
      // A prompt ends the stretch: what comes after it is a turn of its own. The
      // tool messages in between belong to the turn and are passed over — the
      // rows they answered are drawn by the calls that asked.
      if (message.role === "user") {
        if (held.length > 0) settle(held[held.length - 1]);
        continue;
      }
      if (message.role !== "assistant") continue;
      carry(message);
      // The message with something to say is the one the run answers through.
      if (contentText(message.content) !== "") settle(message);
    }
    // A turn that ended on a call — stopped there, or waiting on the user —
    // still shows what it thought, on the last round that asked.
    if (held.length > 0) settle(held[held.length - 1]);

    return out;
  }, [messages]);

  /**
   * Where each message is headed: what the name and the time over it belong to.
   *
   * A turn is one block in the transcript however many rounds it took to answer,
   * so its head is drawn once, on the round that opened it — the person's own
   * message, and then the model's first round. Everything the turn did after that
   * was said under that head: the rounds that went round again ask for tools and
   * say nothing of their own, and they are drawn down the same column as the
   * prose they belong to, which is where a reader looking for what the answer did
   * will look for it. Putting the head on the message that has the last word
   * instead would leave every call standing above the name of whoever asked for
   * it.
   *
   * A prompt carries the time it was sent. An answer does not — what it has is
   * what it waited, from the request to its first token — so the round that opens
   * a turn is marked with the moment the model began speaking, the prompt's own
   * time plus that wait, which is also the moment the live row is marked with
   * while it arrives. A message written before the app kept either is headed with
   * its name and no time, rather than with a time worked out from what it does
   * not say.
   */
  const heads = useMemo(() => {
    const where = new Set<UiMessage>();
    const when = new Map<UiMessage, number>();
    let written: number | undefined;
    // Whether the next round the model writes opens its turn. A prompt opens one,
    // and everything the model says before its next prompt is that turn.
    let opening = true;
    for (const message of messages) {
      if (message.role === "user") {
        written = message.sentAt;
        opening = true;
        where.add(message);
        if (written != null) when.set(message, written);
        continue;
      }
      if (message.role !== "assistant" || !opening) continue;
      opening = false;
      where.add(message);
      if (written != null && message.waitMs != null) when.set(message, written + message.waitMs);
    }
    return { where, when };
  }, [messages]);

  /**
   * Whether the answer arriving opens the block it is drawn in. A turn whose
   * rounds are already in the transcript wears its head on the round that opened
   * it, and what arrives after that is a step inside that block; a response that
   * is the turn's first is what a head is drawn for. A `tool` message counts as a
   * round of the model's for the same reason it is not drawn here: the call that
   * asked for it is in the transcript, so the answer being watched is not the
   * first thing the turn has said.
   */
  const last = messages[messages.length - 1];
  const pendingHead = last === undefined || (last.role !== "assistant" && last.role !== "tool");

  /**
   * The thread's own seam: the message that opened it, and how much was said
   * after it.
   *
   * A reply is something said rather than a step in a turn, which is the count
   * the feed's row already shows and the count the store keeps: the person's own
   * messages and the model's answers, with the tool results left out. It is drawn
   * under the message that opened the thread, which is where a reader looking for
   * what came of it starts reading, and a thread whose turn said nothing under it
   * has no seam to draw.
   */
  const opening = messages.findIndex((message) => message.role === "user");
  const replies =
    opening < 0
      ? 0
      : messages.filter((m, i) => i > opening && (m.role === "user" || m.role === "assistant"))
          .length;

  /**
   * What one message's calls were answered with, in the order it asked for them.
   *
   * Held against the message the array belongs to, because the row it is handed
   * to is memoized on its props: the array the pairing just built is fresh on
   * every render, and a fresh one per token would re-render every call in the
   * chat on every token. The array is kept for as long as the answers in it are
   * the same ones.
   */
  const held = useRef(new WeakMap<UiMessage, (UiMessage | undefined)[]>()).current;
  function resultsFor(message: UiMessage): (UiMessage | undefined)[] | undefined {
    const calls = message.tool_calls;
    if (!calls || calls.length === 0) return undefined;
    const found = calls.map((call) => pairing.answers.get(call.id));
    const kept = held.get(message);
    if (kept && kept.length === found.length && kept.every((was, i) => was === found[i])) {
      return kept;
    }
    held.set(message, found);
    return found;
  }

  /**
   * The thought to hand a message, kept by identity for as long as it says the
   * same thing: the row it goes to is memoized on its props, and a fresh object
   * per render would re-render — and re-parse — every message in the chat on
   * every token.
   */
  const thoughts = useRef(new WeakMap<UiMessage, Thought | null>()).current;
  function thoughtFor(message: UiMessage): Thought | null {
    const found = thought.get(message) ?? null;
    const kept = thoughts.get(message);
    if (
      kept !== undefined &&
      (kept === null
        ? found === null
        : found !== null &&
          kept.text === found.text &&
          kept.waitMs === found.waitMs &&
          kept.thinkingMs === found.thinkingMs)
    ) {
      return kept;
    }
    thoughts.set(message, found);
    return found;
  }

  // The render that grew the transcript is the one that pins it, and every token
  // in a frame shares that pass. A message that arrived while nothing was
  // arriving re-attaches first: the reader may have scrolled away to read, but
  // what is new is new, and it is waiting at the end. One that merely ends a
  // stream is the answer they just watched arrive, and a reader who left it has
  // left it on purpose. A follow that came back from outside — a send, an edit
  // asked again — is a pass of its own, whether or not anything grew.
  useLayoutEffect(() => {
    const grew = messages.length > seen.current.count;
    const settling = seen.current.streaming;
    seen.current = { count: messages.length, streaming: pending !== null };
    if (grew && !settling) pin.claim();
    pin.pass();
  }, [messages, pending, error, follow]);

  return (
    <div className="messages-wrap">
      <main className="messages" ref={scrollRef} onScroll={pin.onScroll} onWheel={pin.onWheel}>
        {messages.map((message, i) => {
          // A tool message is drawn inside the row of the call it answered, so
          // it is not drawn here as well. One whose call is not in the transcript
          // — a chat cut short, a row written by hand — is drawn on its own,
          // which is all there is to show.
          if (
            message.role === "tool" &&
            message.tool_call_id &&
            pairing.asked.has(message.tool_call_id)
          ) {
            return null;
          }
          return (
            <Fragment key={i}>
              <ChatMessage
                message={message}
                index={i}
                author={author}
                head={heads.where.has(message)}
                when={heads.when.get(message)}
                thought={thoughtFor(message)}
                results={resultsFor(message)}
                canAct={canAct}
                onRegenerate={onRegenerate}
                onEdit={onEdit}
              />
              {/* Under the message that opened the thread: how much was said
                  after it, and the line that sets those replies apart from it. */}
              {i === opening && replies > 0 && (
                <div className="reply-rule">{replies === 1 ? "1 reply" : `${replies} replies`}</div>
              )}
            </Fragment>
          );
        })}
        {pending && <StreamingMessage pending={pending} head={pendingHead} />}
        {error !== "" && <div className="msg error">Error: {error}</div>}
      </main>
      {!follow && <ToBottom onClick={pin.toEnd} />}
    </div>
  );
}
