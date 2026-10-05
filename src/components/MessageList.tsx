import { useEffect, useLayoutEffect, useMemo, useRef, type WheelEvent } from "react";
import { ArrowDown } from "lucide-react";
import { contentText, reasoningText, type Partial, type Thought, type UiMessage } from "../types";
import { ChatMessage } from "./ChatMessage";
import { StreamingMessage } from "./StreamingMessage";

/**
 * While an answer arrives the transcript is held at its own end: the newest line
 * is the last one on screen, and the view never sits a viewport above it. The
 * moment the reader moves the view away, it is theirs — that is what reading
 * looks like — and the ↓ button on the transcript's edge hands it back.
 *
 * Three facts about the situation shape how that is done, and the rest of this
 * file is those three facts:
 *
 *   - A stream delivers several tokens per frame. Pinning once per token meant a
 *     layout read and a scroll write for each of them, which stuttered under the
 *     wheel, so a pass is coalesced: everything that grows the transcript asks
 *     for one, and one runs.
 *   - A pass is timed rather than taken on an animation frame. Frames are not
 *     delivered to a window the compositor is not drawing — hidden, occluded, or
 *     with the display asleep — and a pass waiting on one is a pass the
 *     transcript never gets: it would sit wherever it stopped for as long as the
 *     window stayed in the background.
 *   - The pin races every gesture. It runs before the browser has told the main
 *     thread about the move a wheel made, so a stream fast enough pins the end
 *     back over that move and the gesture is never seen at all. A wheel is
 *     therefore held, with the pin standing off until the move has landed — and
 *     never judged on its own, since a trackpad delivers a scroll as a stream of
 *     small deltas whose sum is the gesture.
 *   - Nothing in the transcript's own position says whether the reader put it
 *     there or the layout did: an arriving answer pushes the end away without
 *     moving the view at all. So a reader's move is read from the direction of
 *     the offset, and a message that arrives is taken as a claim on the view —
 *     for as long as it takes a pass to put the view back at the end, during
 *     which the position reports are the layout's and are left alone.
 */

/** How far, in px, from the end the view still counts as being at it. */
const MOVE_SLACK = 16;
/** How long passes are spaced, in ms: one per frame, at a frame's pace. */
const PASS_MS = 16;
/** How long a wheel is given to land before the pin resumes, in ms. */
const LAND_MS = 120;

interface Props {
  messages: UiMessage[];
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
  pending,
  error,
  follow,
  onFollowChange,
  canAct,
  onRegenerate,
  onEdit,
}: Props) {
  const scrollRef = useRef<HTMLElement>(null);
  /** The pass waiting to run, in ms; 0 when none is scheduled. */
  const pass = useRef(0);
  /** What a pass acts on: kept in step with the prop, read between renders. */
  const following = useRef(follow);
  /** Until when the pin stands off for a wheel that is landing, in ms.
      Refreshed by every wheel event, since a trackpad sends them in a stream. */
  const gesture = useRef(0);
  /** The transcript as the last pass saw it: how many messages, and whether an
      answer was arriving then. A message that arrives with none arriving is new
      to the reader, whoever put it there, and brings the view back. */
  const seen = useRef({ count: messages.length, streaming: pending !== null });
  /** The offset the last scroll event saw, for telling a move of the reader's
      from the layout's: only the reader lowers the offset. */
  const lastTop = useRef(0);
  /** Set while the view is being taken to the end, until a pass has put it there.
      The position reports of that stretch are the layout's, not the reader's: a
      message arriving moves the transcript under the view, and the browser
      reports that as a scroll like any other. */
  const going = useRef(false);

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

  /** Distance from the end of the transcript, in px. */
  function gapToEnd(el: HTMLElement) {
    return el.scrollHeight - el.clientHeight - el.scrollTop;
  }

  /** Attaches the view to the end, or hands it to the reader, as one report. */
  function report(attached: boolean) {
    if (following.current === attached) return;
    following.current = attached;
    onFollowChange(attached);
  }

  /** One pass: holds the view at the end of the transcript. */
  function settle() {
    const el = scrollRef.current;
    if (!el) return;
    // A wheel is still landing. Pinning now would put the end back over the move
    // it is making before the browser has reported it, which is what a stream
    // fast enough does to a reader who is scrolling away. The pass comes back for
    // the rest of the wait rather than dropping the pin with it.
    if (performance.now() < gesture.current) {
      schedule(gesture.current - performance.now());
      return;
    }
    if (!following.current) return;
    el.scrollTop = el.scrollHeight;
    // The view is at the end of the transcript again, so the position may speak
    // for the view once more.
    going.current = false;
  }

  /** Runs a pass, coalescing everything that asks for one inside its pace. */
  function schedule(delay = 0) {
    if (pass.current !== 0) return;
    pass.current = window.setTimeout(() => {
      pass.current = 0;
      settle();
    }, Math.max(delay, PASS_MS));
  }

  // The render that grew the transcript is the one that pins it, and every token
  // in a frame shares that pass. A message that arrived while nothing was
  // arriving re-attaches first: the reader may have scrolled away to read, but
  // what is new is new, and it is waiting at the end. One that merely ends a
  // stream is the answer they just watched arrive, and a reader who left it has
  // left it on purpose.
  useLayoutEffect(() => {
    const grew = messages.length > seen.current.count;
    const settles = seen.current.streaming;
    seen.current = { count: messages.length, streaming: pending !== null };
    if (grew && !settles) {
      // On the way to the end: the position reports of the next stretch are the
      // layout's — a message arriving moves the transcript under the view, and
      // the browser reports that as a scroll like any other.
      going.current = true;
      report(true);
    } else following.current = follow;
    schedule();
  }, [messages, pending, error, follow]);

  useEffect(
    () => () => {
      clearTimeout(pass.current);
      // Zeroed as well as cancelled: the mount React simulates in development
      // cancels this timer and then runs the effect again, and a slot still
      // holding a cancelled pass would swallow every pass after it — the
      // transcript would never be pinned again for the life of the window.
      pass.current = 0;
    },
    [],
  );

  // A transcript that changes height under the view — a window resize, or the
  // composer growing — moves the end of it, which a pass has to follow even
  // though nothing grew.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let height = el.clientHeight;
    const observer = new ResizeObserver(() => {
      if (el.clientHeight === height) return;
      height = el.clientHeight;
      schedule();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /**
   * A wheel stands the pin off until its move has landed, refreshed by every
   * event: a trackpad delivers a scroll as a stream of small ones, and what a
   * reader did is their sum, which the view's own position then reports. A pass
   * is asked for so that the end is restored once the gesture stops — whether or
   * not it moved anything, since a wheel at a transcript with nowhere to go
   * reports nothing at all.
   */
  function handleWheel(event: WheelEvent<HTMLElement>) {
    if (event.deltaY >= 0) return;
    gesture.current = performance.now() + LAND_MS;
    schedule(LAND_MS);
  }

  /**
   * At the end of the transcript the view follows; away from it, only a move the
   * reader made ends the follow. Which of the two an offset is cannot be read
   * from its distance alone — an answer arriving under the view pushes the end of
   * the transcript away from it without moving it at all, and a stream fast
   * enough keeps it outside the slack — so it is read from the direction: growth
   * leaves the offset alone, the pin raises it, and only the reader lowers it.
   * The slack keeps a move too small to see from ending anything.
   */
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const gap = gapToEnd(el);
    const top = el.scrollTop;
    const previous = lastTop.current;
    lastTop.current = top;
    if (going.current) return;
    if (gap <= MOVE_SLACK) report(true);
    else if (top < previous) report(false);
  }

  /** The ↓ button: the end, now, with any landing wheel dropped. */
  function jumpToEnd() {
    const el = scrollRef.current;
    if (!el) return;
    gesture.current = 0;
    going.current = true;
    report(true);
    el.scrollTop = el.scrollHeight;
    going.current = false;
  }

  return (
    <div className="messages-wrap">
      <main className="messages" ref={scrollRef} onScroll={handleScroll} onWheel={handleWheel}>
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
            <ChatMessage
              key={i}
              message={message}
              index={i}
              thought={thoughtFor(message)}
              results={resultsFor(message)}
              canAct={canAct}
              onRegenerate={onRegenerate}
              onEdit={onEdit}
            />
          );
        })}
        {pending && <StreamingMessage pending={pending} />}
        {error !== "" && <div className="msg error">Error: {error}</div>}
      </main>
      {!follow && (
        <button
          className="to-bottom"
          onClick={jumpToEnd}
          aria-label="Scroll to the latest"
          title="Scroll to the latest"
        >
          <ArrowDown size={16} />
        </button>
      )}
    </div>
  );
}
