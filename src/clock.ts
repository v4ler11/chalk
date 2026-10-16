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

/** `Sep 2026`. */
function month(at: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(at);
}

/** Midnight of the Monday that opened the week `at` is in: `getDay()` counts
 *  from Sunday, and the week read here opens on the Monday. */
function weekStart(at: number): number {
  const date = new Date(at);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  return date.getTime();
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
 * Which stretch of the feed a thread belongs to, for the divider that opens it:
 * `Today`, `Yesterday`, `This Week`, `This Month`, and then the month it was in,
 * `Sep 2026`. The order they are read in is the order they are tested in, so
 * nothing falls in two of them: a thread posted on the Sunday of a week that has
 * since turned is yesterday's rather than this week's, and one from last month
 * is its own month's rather than this one's. It is what the dividers are drawn
 * from, one per label, and what a row's own time is set beside.
 *
 * Read off the reader's own clock and calendar, as everything else here is: their
 * midnights, their week opening on Monday, their month. A time in the future — a
 * clock that moved between the write and the read — reads as today, as it does
 * everywhere else.
 */
export function period(at: number, now: number = Date.now()): string {
  const days = daysBefore(at, now);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (weekStart(at) === weekStart(now)) return "This Week";
  const date = new Date(at);
  const today = new Date(now);
  if (date.getMonth() === today.getMonth() && date.getFullYear() === today.getFullYear()) {
    return "This Month";
  }
  return month(at);
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
