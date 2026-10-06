import { Pin } from "lucide-react";
import { lastReply, pinned } from "../clock";
import type { ChatSummary } from "../types";
import { Avatar } from "./Avatar";

interface Props {
  /** The pinned threads, most recently pinned first. */
  pins: ChatSummary[];
  /** What the app calls the person using it: a thread is what they posted, so the
   *  mark and the name a row wears are theirs. */
  author: string;
  /** Opens the thread a pin is. */
  onOpen: (pin: ChatSummary) => void;
}

/**
 * The threads that are pinned, gathered out of the channel.
 *
 * A thread is what is pinned, so a row here has the shape of the row it has in
 * the feed — the face of whoever posted it, their prompt, and how much has come
 * back — and the one thing added is when it was pinned, which is what this list is
 * ordered by and the only thing about a pin the feed does not already say.
 */
export function PinsView({ pins, author, onOpen }: Props) {
  if (pins.length === 0) {
    return (
      <div className="pins-empty">
        <Pin />
        <p className="json-note">
          Nothing is pinned yet. Hover a thread in the channel and pin it, and it will be here.
        </p>
      </div>
    );
  }

  return (
    <ul className="pin-list">
      {pins.map((pin) => (
        <li key={pin.id}>
          <button className="pin-row" onClick={() => onOpen(pin)}>
            <Avatar who={author} size={30} />
            <span className="pin-body">
              <span className="pin-head">
                <span className="pin-who">{author}</span>
                <span className="pin-when">{pinned(pin.pinnedAt)}</span>
              </span>
              <span className="pin-said">{pin.root === "" ? "(no words)" : pin.root}</span>
              <span className="pin-thread">
                {pin.replies === 0
                  ? "no replies yet"
                  : `${pin.replies === 1 ? "1 reply" : `${pin.replies} replies`} · ${lastReply(pin.updatedAt)}`}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
