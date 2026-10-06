import { useEffect, useLayoutEffect, useRef, type RefObject, type WheelEvent } from "react";

/**
 * Holding a scrolling view at its own end while content arrives under it, and
 * handing it to the reader the moment they move it.
 *
 * The transcript and the feed follow their end the same way and have the same
 * problem, so the machinery lives here once and each surface keeps only its own
 * policy: what counts as growth, and whether a growth is a claim on the view.
 *
 * Four facts about the situation shape how it is done, and the rest of this file
 * is those four facts:
 *
 *   - A stream delivers several tokens per frame. Pinning once per token meant a
 *     layout read and a scroll write for each of them, which stuttered under the
 *     wheel, so a pass is coalesced: everything that grows the content asks for
 *     one, and one runs.
 *   - A pass is timed rather than taken on an animation frame. Frames are not
 *     delivered to a window the compositor is not drawing — hidden, occluded, or
 *     with the display asleep — and a pass waiting on one is a pass the view
 *     never gets: it would sit wherever it stopped for as long as the window
 *     stayed in the background.
 *   - The pin races every gesture. It runs before the browser has told the main
 *     thread about the move a wheel made, so a stream fast enough pins the end
 *     back over that move and the gesture is never seen at all. A wheel is
 *     therefore held, with the pin standing off until the move has landed — and
 *     never judged on its own, since a trackpad delivers a scroll as a stream of
 *     small deltas whose sum is the gesture.
 *   - Nothing in the view's own position says whether the reader put it there or
 *     the layout did: arriving content pushes the end away without moving the
 *     view at all. So a reader's move is read from the direction of the offset,
 *     and content that arrives is taken as a claim on the view — for as long as
 *     it takes a pass to put the view back at the end, during which the position
 *     reports are the layout's and are left alone.
 */

/** How far, in px, from the end the view still counts as being at it. */
const MOVE_SLACK = 16;
/** How long passes are spaced, in ms: one per frame, at a frame's pace. */
const PASS_MS = 16;
/** How long a wheel is given to land before the pin resumes, in ms. */
const LAND_MS = 120;

/** What the view reports back, and what the caller's policy asks of it. */
interface FollowEnd {
  /** The view's own position, as it moves. */
  onScroll: () => void;
  /** A wheel: a gesture the pin stands off for until it has landed. */
  onWheel: (event: WheelEvent<HTMLElement>) => void;
  /** The ↓ button: the end, now, with any landing wheel dropped. */
  toEnd: () => void;
  /** Contents about to be drawn that grew: the view goes to the end with it,
   *  whoever put it there. Called while rendering that change, before the pass. */
  claim: () => void;
  /** Hand the view to the reader, so what follows is theirs rather than the
   *  end's: for a move the caller makes that is not a wheel — a jump to a place
   *  in the content, which the reader asked for. */
  detach: () => void;
  /** Ask for a pass: hold the end, if the view is following it. */
  pass: () => void;
}

export function useFollowEnd({
  ref,
  follow,
  onFollowChange,
}: {
  /** The element that scrolls. */
  ref: RefObject<HTMLElement | null>;
  /** Whether the view follows new content. Stays on unless the reader scrolls
   *  up, and comes back when they reach the bottom, send, or press ↓. */
  follow: boolean;
  /** Where that reading is kept, for whoever owns the state. Called only when
   *  the view's own answer to it changes. */
  onFollowChange: (follow: boolean) => void;
}): FollowEnd {
  /** The pass waiting to run, in ms; 0 when none is scheduled. */
  const waiting = useRef(0);
  /** What a pass acts on: kept in step with the prop, read between renders. */
  const following = useRef(follow);
  /** Until when the pin stands off for a wheel that is landing, in ms.
      Refreshed by every wheel event, since a trackpad sends them in a stream. */
  const gesture = useRef(0);
  /** The offset the last scroll event saw, for telling a move of the reader's
      from the layout's: only the reader lowers the offset. */
  const lastTop = useRef(0);
  /** Set while the view is being taken to the end, until a pass has put it there.
      The position reports of that stretch are the layout's, not the reader's:
      content arriving moves the view's contents under it, and the browser
      reports that as a scroll like any other. */
  const going = useRef(false);

  // The state the caller holds is the one anyone outside the view writes — a
  // send, an edit asked again — so the view reads it back as its own before the
  // render that grew the content decides what to do about it. This runs before
  // the caller's own layout effects, which are declared below this hook.
  useLayoutEffect(() => {
    following.current = follow;
  }, [follow]);

  /** Attaches the view to the end, or hands it to the reader, as one report. */
  function report(attached: boolean) {
    if (following.current === attached) return;
    following.current = attached;
    onFollowChange(attached);
  }

  /** How much of the view's own content is out of sight below it, leaving out the
   *  air at its foot. Zero or less is the end: the last line is on screen, which
   *  is where a reader following the view wants it — whether or not the composer
   *  under the pane has taken that air, which is the room the pane gives up first
   *  and is not the view's place to move for. */
  function shortfall(el: HTMLElement) {
    const air = parseFloat(getComputedStyle(el).paddingBottom) || 0;
    return el.scrollHeight - air - (el.scrollTop + el.clientHeight);
  }

  /** One pass: holds the view at the end. */
  function settle() {
    const el = ref.current;
    if (!el) return;
    // A wheel is still landing. Pinning now would put the end back over the move
    // it is making before the browser has reported it, which is what a stream
    // fast enough does to a reader who is scrolling away. The pass comes back for
    // the rest of the wait rather than dropping the pin with it.
    if (performance.now() < gesture.current) {
      pass(gesture.current - performance.now());
      return;
    }
    // The pass answers a claim whether or not it moves anything, so the position
    // may speak for the view once it has run.
    going.current = false;
    if (!following.current) return;
    // The air given up to the composer is already the end: the last line is on
    // screen, and taking the offset to the pixel below it would be a jump the
    // reader never asked for — the one that reads as the feed bouncing a moment
    // after the composer grew, or a keystroke later.
    if (shortfall(el) <= 0) return;
    el.scrollTop = el.scrollHeight;
  }

  /** Runs a pass, coalescing everything that asks for one inside its pace. */
  function pass(delay = 0) {
    if (waiting.current !== 0) return;
    waiting.current = window.setTimeout(() => {
      waiting.current = 0;
      settle();
    }, Math.max(delay, PASS_MS));
  }

  function claim() {
    // On the way to the end: the position reports of the next stretch are the
    // layout's — content arriving moves it under the view, and the browser
    // reports that as a scroll like any other.
    going.current = true;
    report(true);
  }

  function detach() {
    report(false);
  }

  useEffect(
    () => () => {
      clearTimeout(waiting.current);
      // Zeroed as well as cancelled: the mount React simulates in development
      // cancels this timer and then runs the effect again, and a slot still
      // holding a cancelled pass would swallow every pass after it — the view
      // would never be pinned again for the life of the window.
      waiting.current = 0;
    },
    [],
  );

  // A view whose box changes height under it moves the end of it, and a box is
  // not content: the composer under a pane grows a line at a time, and the window
  // is resized, and neither of those is a claim on the view. What the box takes
  // first is the air at the view's own foot — the padding under its last line,
  // which is what one line of a composer is worth — so the line that grows the
  // composer from one to two moves nothing at all, and the reader typing it sees
  // the feed stand still. Past that air the content would leave the view, and the
  // view follows it, by the difference exactly.
  //
  // The scroll is written here rather than asked for as a pass, so that it lands
  // in the same frame as the box change that caused it: one movement, where a
  // pass would be a movement and then a jump. A box that *grows* needs nothing
  // written at all, since the browser clamps an offset that has fallen past its
  // own end while it lays the change out.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let height = el.clientHeight;
    const observer = new ResizeObserver(() => {
      const now = el.clientHeight;
      if (now === height) return;
      height = now;
      // A view the reader has taken, and a wheel still landing, are the reader's
      // and not the layout's to move.
      if (!following.current) return;
      if (performance.now() < gesture.current) return;
      const short = shortfall(el);
      if (short > 0) el.scrollTop += short;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);

  /**
   * A wheel stands the pin off until its move has landed, refreshed by every
   * event: a trackpad delivers a scroll as a stream of small ones, and what a
   * reader did is their sum, which the view's own position then reports. A pass
   * is asked for so that the end is restored once the gesture stops — whether or
   * not it moved anything, since a wheel at a view with nowhere to go reports
   * nothing at all.
   */
  function onWheel(event: WheelEvent<HTMLElement>) {
    if (event.deltaY >= 0) return;
    gesture.current = performance.now() + LAND_MS;
    pass(LAND_MS);
  }

  /**
   * At the end of the view being followed, the view follows; away from it, only a
   * move the reader made ends the follow. Which of the two an offset is cannot be
   * read from its distance alone — content arriving under the view pushes the end
   * away from it without moving it at all, and a stream fast enough keeps it
   * outside the slack — so it is read from the direction: growth leaves the
   * offset alone, the pin raises it, and only the reader lowers it. The slack
   * keeps a move too small to see from ending anything.
   */
  function onScroll() {
    const el = ref.current;
    if (!el) return;
    const gap = el.scrollHeight - el.clientHeight - el.scrollTop;
    const top = el.scrollTop;
    const previous = lastTop.current;
    lastTop.current = top;
    if (going.current) return;
    if (gap <= MOVE_SLACK) report(true);
    else if (top < previous) report(false);
  }

  /** The ↓ button: the end, now, with any landing wheel dropped. */
  function toEnd() {
    const el = ref.current;
    if (!el) return;
    gesture.current = 0;
    going.current = true;
    report(true);
    el.scrollTop = el.scrollHeight;
    going.current = false;
  }

  return { onScroll, onWheel, toEnd, claim, detach, pass };
}
