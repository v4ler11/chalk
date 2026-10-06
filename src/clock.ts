/**
 * When something was said, the way a channel writes it.
 *
 * The hour and the minute are enough while it is today: a thread posted this
 * morning reads "10:15 AM", one posted yesterday says so, and an older one names
 * its day. The shape is Slack's, since the feed is arranged the way Slack's
 * channel is, and the reader's own clock and calendar are what it is written
 * from — the same `Intl` the rest of the app's numbers go through, so a machine
 * set to another locale reads its own.
 */

/** `10:15 AM`. */
function time(at: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(at);
}

/** `3 Mar`. */
function day(at: number): string {
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(at);
}

/**
 * How many midnights ago `at` was, by the reader's own. Counted in days rather
 * than in elapsed hours, so something said at 00:10 this morning is "today"
 * however few hours ago it was.
 */
function daysBefore(at: number, now: number): number {
  const midnight = (ms: number) => {
    const date = new Date(ms);
    date.setHours(0, 0, 0, 0);
    return date.getTime();
  };
  return Math.round((midnight(now) - midnight(at)) / 86_400_000);
}

/**
 * When a message was sent: `10:15 AM`, `Yesterday at 10:15 AM`, or
 * `3 Mar at 10:15 AM` for anything older. A time in the future — a clock that
 * moved between the write and the read — reads as today rather than as a day
 * that has not happened.
 */
export function sentAt(at: number, now: number = Date.now()): string {
  const days = daysBefore(at, now);
  if (days <= 0) return time(at);
  if (days === 1) return `Yesterday at ${time(at)}`;
  return `${day(at)} at ${time(at)}`;
}

/**
 * When a thread was last answered: `Last reply today at 10:27 AM`, and the same
 * three shapes. It is said about the last *message*, which is what the row's own
 * time is kept for: a change of model or level is not a reply.
 */
export function lastReply(at: number, now: number = Date.now()): string {
  const days = daysBefore(at, now);
  if (days <= 0) return `Last reply today at ${time(at)}`;
  if (days === 1) return `Last reply yesterday at ${time(at)}`;
  return `Last reply on ${day(at)} at ${time(at)}`;
}
