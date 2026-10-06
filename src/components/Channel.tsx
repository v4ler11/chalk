import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type WheelEvent,
} from "react";
import { ArrowDown } from "lucide-react";
import { ChannelRowItem, type ChannelRow } from "./ChannelRow";
import { period } from "../clock";
import "../styles/channel.css";

export type { ChannelRow } from "./ChannelRow";

interface ChannelProps {
  /** The threads, oldest first: the feed draws them in that order. */
  rows: ChannelRow[];
  /** What the channel calls the person whose prompts these are: their name out
   *  of the settings, or "You" while they have not written one. */
  author: string;
  /** What the channel has to say about the last thing that failed. */
  error: string;
  onOpen: (chat: number) => void;
  onDelete: (chat: number) => void;
  /** The composer itself, fixed below the feed. */
  composer: ReactNode;
}

/**
 * The channel: the feed of threads, oldest at the top and newest at the bottom,
 * with the composer fixed under it: one column, arranged the way the chat pane
 * arranges its transcript and footer. The threads are read in stretches — today,
 * yesterday, and back through the weeks and months before them — each opened by a
 * divider that stays at the top of the pane as its own stretch goes by.
 *
 * The feed follows its own end the way the transcript does: while a thread is
 * added under the view the newest row stays on screen, and the moment the reader
 * scrolls up the view is theirs, with the ↓ button handing it back. The two
 * share the problem the transcript has: an arriving row pushes the end away
 * without moving the view, and a layout change reports itself as a scroll. So a
 * pass is coalesced, a wheel is given time to land, and a move is read from the
 * direction of the offset.
 */

/** How far, in px, from the end the view still counts as being at it. */
const MOVE_SLACK = 16;
/** How long passes are spaced, in ms: one per frame, at a frame's pace. */
const PASS_MS = 16;
/** How long a wheel is given to land before the pin resumes, in ms. */
const LAND_MS = 120;

export function Channel({
  rows,
  author,
  error,
  onOpen,
  onDelete,
  composer,
}: ChannelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  /** The pass waiting to run, in ms; 0 when none is scheduled. */
  const pass = useRef(0);
  /** Whether the feed should stay at its end; the state below only draws the
      ↓ button, and this is what reads it between renders. */
  const following = useRef(true);
  /** Until when the pin stands off for a wheel that is landing, in ms. */
  const gesture = useRef(0);
  /** The offset the last scroll event saw, for telling a move of the reader's
      from the layout's: only the reader lowers the offset. */
  const lastTop = useRef(0);
  /** Set while the feed is being taken to the end, until a pass has put it
      there: the position reports of that stretch are the layout's. */
  const going = useRef(false);
  /** How many rows the last pass saw, so an arriving thread is a claim on the
      view even when the reader had scrolled away to read. */
  const seen = useRef(rows.length);
  const [follow, setFollow] = useState(true);

  /** The feed in stretches, one divider each: a row opens a new stretch when the
   *  period it belongs to is not the one before it. The rows arrive oldest
   *  first, so they are read in the order they are drawn in and no stretch has
   *  to be looked up twice. */
  const groups = useMemo(() => {
    const now = Date.now();
    const stretches: { label: string; rows: ChannelRow[] }[] = [];
    for (const row of rows) {
      const label = period(row.createdAt, now);
      const open = stretches[stretches.length - 1];
      if (open && open.label === label) open.rows.push(row);
      else stretches.push({ label, rows: [row] });
    }
    return stretches;
  }, [rows]);

  /** Attaches the view to the end, or hands it to the reader, as one report. */
  function report(attached: boolean) {
    if (following.current === attached) return;
    following.current = attached;
    setFollow(attached);
  }

  /** One pass: holds the feed at its end. */
  function settle() {
    const el = scrollRef.current;
    if (!el) return;
    // A wheel is still landing. Pinning now would put the end back over the move
    // it is making before the browser has reported it. The pass comes back for
    // the rest of the wait rather than dropping the pin with it.
    if (performance.now() < gesture.current) {
      schedule(gesture.current - performance.now());
      return;
    }
    if (!following.current) return;
    el.scrollTop = el.scrollHeight;
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

  // The render that grew the feed is the one that pins it. A thread that arrived
  // re-attaches first: the reader may have scrolled up to read, but what is new
  // is new and it is waiting at the end. A row that only changed its status is
  // followed only while the feed was already being followed.
  useLayoutEffect(() => {
    const grew = rows.length > seen.current;
    seen.current = rows.length;
    if (grew) {
      going.current = true;
      report(true);
    }
    schedule();
  }, [rows, error, follow]);

  useEffect(
    () => () => {
      clearTimeout(pass.current);
      // Zeroed as well as cancelled: the mount React simulates in development
      // cancels this timer and then runs the effect again, and a slot still
      // holding a cancelled pass would swallow every pass after it.
      pass.current = 0;
    },
    [],
  );

  // The feed changes height under the view, whether a row grows a line or the
  // window resizes, and a pass has to follow that even though nothing grew.
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

  /** A wheel stands the pin off until its move has landed, refreshed by every
      event, since a trackpad delivers a scroll as a stream of small ones. */
  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (event.deltaY >= 0) return;
    gesture.current = performance.now() + LAND_MS;
    schedule(LAND_MS);
  }

  /** At the end the feed follows; away from it, only a move the reader made
      ends the follow. Direction tells the two apart: growth and the pin both
      raise the offset, and only the reader lowers it. */
  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    const gap = el.scrollHeight - el.clientHeight - el.scrollTop;
    const top = el.scrollTop;
    const previous = lastTop.current;
    lastTop.current = top;
    if (going.current) return;
    if (gap <= MOVE_SLACK) report(true);
    else if (top < previous) report(false);
  }

  /** The divider: back to the start of the stretch it names. The section is
      taken to the top of what the feed shows, which is its content's own top
      rather than its box's — the band above it is the strip the window's chrome
      floats over — and the view stops following the end on the way: the reader
      asked for this place, not for the last thread. */
  function jumpTo(section: HTMLElement | null) {
    const el = scrollRef.current;
    if (!el || !section) return;
    const pad = parseFloat(getComputedStyle(el).paddingTop) || 0;
    const top =
      section.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop - pad;
    // Reported before the scroll, so a pass already scheduled cannot put the end
    // back under the view while the reader is on their way up.
    report(false);
    el.scrollTo({ top, behavior: "smooth" });
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
    <>
      <div className="channel-wrap">
        <div
          className="channel-feed"
          ref={scrollRef}
          onScroll={handleScroll}
          onWheel={handleWheel}
        >
          <div className="channel-list">
            {groups.map((group) => (
              <div className="channel-group" key={group.rows[0].chat}>
                <FeedDivider label={group.label} onJump={jumpTo} />
                {group.rows.map((row) => (
                  <ChannelRowItem
                    key={row.chat}
                    row={row}
                    author={author}
                    onOpen={onOpen}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            ))}
          </div>
          {error !== "" && <div className="channel-error">Error: {error}</div>}
        </div>
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

      <footer className="composer-bar">{composer}</footer>
    </>
  );
}

/**
 * The divider that opens a stretch of the feed: a pill naming the period it
 * holds, standing on a rule that runs the column. The pill is pinned to the top
 * of the pane, so while its own stretch is what is under it the pill names what
 * the reader is in rather than what has gone by; the rule belongs to the stretch
 * and is left behind as the feed moves, so a divider that has been scrolled under
 * is a pill over threads rather than a line between them. Clicking the pill goes
 * back to where its stretch begins.
 */
function FeedDivider({
  label,
  onJump,
}: {
  label: string;
  onJump: (section: HTMLElement | null) => void;
}) {
  return (
    <div className="channel-divider">
      <button
        className="channel-pill"
        title={`Back to ${label}`}
        onClick={(event) => onJump(event.currentTarget.closest<HTMLElement>(".channel-group"))}
      >
        {label}
      </button>
    </div>
  );
}
