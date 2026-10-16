import { useEffect, useState } from "react";

/** How often the displayed timers are refreshed. Tenths are shown, so they tick at tenths. */
const TICK_MS = 100;

/** A minute in ms: enough for a clock read only to date the rows — a thread
 *  answered at 23:50 says "today" until midnight and "Yesterday" after it, so
 *  the tick has to land inside the minute the day rolls over, and nothing a row
 *  says changes between one minute and the next. */
export const MINUTE_MS = 60_000;

/** Wall-clock ms, re-read on a timer while `active`, once every `period`.
 *
 *  The default is the tenths the streaming timers are shown at; a pane that only
 *  dates its rows passes a minute, so its clock moves when the date does rather
 *  than ten times a second.
 */
export function useTicker(active: boolean, period: number = TICK_MS): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    // Sample immediately: `now` is stale from an earlier render otherwise.
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), period);
    return () => clearInterval(id);
  }, [active, period]);

  return now;
}

/**
 * `0.3s`, then `12.4s`, then `1:23.4`, then `1:02:03.4` — always to a tenth of a
 * second, so a quick answer reads as a duration rather than rounding down to
 * `0s`.
 */
export function formatDuration(ms: number): string {
  const tenths = Math.floor(Math.max(0, ms) / 100);
  const seconds = Math.floor(tenths / 10);
  const tenth = tenths % 10;
  const minutes = Math.floor(seconds / 60);
  const ss = `${String(seconds % 60).padStart(2, "0")}.${tenth}`;
  if (minutes >= 60) {
    return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}:${ss}`;
  }
  if (minutes > 0) return `${minutes}:${ss}`;
  return `${seconds}.${tenth}s`;
}

/**
 * The same, for a wait that is usually over in a moment: `96ms` below a second,
 * and tenths above it.
 *
 * A tool call answers in milliseconds as often as not, and a tenth of a second
 * is a whole order of magnitude coarser than that — `0.0s` says nothing about
 * how long the call took, where `96ms` says all of it.
 */
export function formatBrief(ms: number): string {
  if (ms < 1000) return `${Math.round(Math.max(0, ms))}ms`;
  return formatDuration(ms);
}
