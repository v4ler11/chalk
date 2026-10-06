import { Pin } from "lucide-react";
import { sentAt } from "../clock";
import type { Pin as Pinned } from "../types";
import { ASSISTANT, ASSISTANT_NAME, ASSISTANT_TINT, Avatar } from "./Avatar";

interface Props {
  /** Every pinned message there is, newest pin first. */
  pins: Pinned[];
  /** What the app calls the person using it: the mark and the name a pin of
   *  their own wears. */
  author: string;
  /** Opens the thread a pin was said in, at the message itself. */
  onOpen: (pin: Pinned) => void;
}

/**
 * What has been pinned, gathered out of every thread in the channel.
 *
 * A row is read the way the message it stands for is read: whose it is and when,
 * what it says, and — under it — the thread it was said in, which is where the
 * click goes. What is pinned is a message rather than a note about one, so
 * nothing here is a summary: it is the message, cut where a row ends.
 */
export function PinsView({ pins, author, onOpen }: Props) {
  if (pins.length === 0) {
    return (
      <div className="pins-empty">
        <Pin />
        <p className="json-note">
          Nothing is pinned yet. Hover a message in a thread and pin it, and it will be here
          whatever thread it was said in.
        </p>
      </div>
    );
  }

  return (
    <ul className="pin-list">
      {pins.map((pin) => (
        <li key={`${pin.chat}:${pin.index}`}>
          <button className="pin-row" onClick={() => onOpen(pin)}>
            <Avatar
              who={pin.role === "user" ? author : ASSISTANT}
              size={30}
              colour={pin.role === "user" ? undefined : ASSISTANT_TINT}
            />
            <span className="pin-body">
              <span className="pin-head">
                <span className="pin-who">{pin.role === "user" ? author : ASSISTANT_NAME}</span>
                {/* When the message was sent, where the transcript says; and
                    where it does not — a message written before the app kept a
                    clock — when it was pinned, said as the pin rather than
                    passed off as the message's own time. */}
                <span className="pin-when">
                  {pin.sentAt != null ? sentAt(pin.sentAt) : `pinned ${sentAt(pin.pinnedAt)}`}
                </span>
              </span>
              <span className="pin-said">{pin.text === "" ? "(no words)" : pin.text}</span>
              <span className="pin-thread">{pin.root === "" ? "an untitled thread" : pin.root}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
