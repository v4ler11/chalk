import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ChannelRowItem, type ChannelRow } from "./ChannelRow";
import { period } from "../clock";
import { useFollowEnd } from "../useFollowEnd";
import { ToBottom } from "./ToBottom";
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
 * The feed follows its own end the way the transcript does, with the same pin:
 * `useFollowEnd` holds it there while a thread is added under it, hands it to the
 * reader the moment they scroll up, and gives it back from the ↓ button. What is
 * here is what the feed has to say to it: a row that arrived is a claim on the
 * view whether or not the reader had scrolled away, since what is new is new.
 */

export function Channel({
  rows,
  author,
  error,
  onOpen,
  onDelete,
  composer,
}: ChannelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const pin = useFollowEnd({ ref: scrollRef, follow, onFollowChange: setFollow });
  /** How many rows the last pass saw, so an arriving thread is a claim on the
      view even when the reader had scrolled away to read. */
  const seen = useRef(rows.length);

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

  // The render that grew the feed is the one that pins it. A thread that arrived
  // re-attaches first: the reader may have scrolled up to read, but what is new
  // is new and it is waiting at the end. A row that only changed its status is
  // followed only while the feed was already being followed.
  useLayoutEffect(() => {
    const grew = rows.length > seen.current;
    seen.current = rows.length;
    if (grew) pin.claim();
    pin.pass();
  }, [rows, error, follow]);

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
    // Handed over before the scroll, so a pass already scheduled cannot put the
    // end back under the view while the reader is on their way up.
    pin.detach();
    el.scrollTo({ top, behavior: "smooth" });
  }

  return (
    <>
      <div className="channel-wrap">
        <div
          className="channel-feed"
          ref={scrollRef}
          onScroll={pin.onScroll}
          onWheel={pin.onWheel}
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
        {!follow && <ToBottom onClick={pin.toEnd} />}
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
