import type { ReactNode } from "react";
import { sentAt } from "../clock";

/**
 * Who wrote a message, and when: the name in the app's own voice, and the time a
 * step behind it, on the line the face sits against. A transcript, a feed row and
 * an answer still arriving all head a message this way, which is what makes a
 * thread and the feed read the same.
 *
 * A message written before the app kept the time has none, and is headed with its
 * name alone. `now` is the moment the time is read against, for a caller that has
 * already read the clock for its own purposes.
 *
 * `mark` is what a row wears before its name — the pin on a pinned thread — and
 * it is here rather than on a line of its own because a row's height is settled
 * when it is written: a mark that arrived later must not push the rows under it
 * down.
 */
export function MessageHead({
  who,
  when,
  now,
  mark,
}: {
  who: string;
  when?: number;
  now?: number;
  mark?: ReactNode;
}) {
  return (
    <div className="msg-head">
      {mark}
      <span className="msg-who">{who}</span>
      {when != null && <span className="msg-when">{sentAt(when, now)}</span>}
    </div>
  );
}
