import { Hash, Pin } from "lucide-react";

interface Props {
  /** Whether the pins are the pane, which is what marks the row that opened them. */
  pinsOpen: boolean;
  onChannel: () => void;
  onPins: () => void;
}

/**
 * The window's own column: what there is to look at, one row each — the channel
 * the threads rest in, and the pins gathered out of all of them.
 *
 * It is narrow, and it is there in both views: a thread is opened *in* the
 * channel rather than instead of it, so the column that says which of the two is
 * showing must not come and go with the pane. Its head is where the window's
 * chrome sits, which is why the column is as wide as it is.
 */
export function Sidebar({ pinsOpen, onChannel, onPins }: Props) {
  return (
    <aside className="sidebar">
      <nav className="sidebar-list" aria-label="Views">
        <button
          className={`nav-row${pinsOpen ? "" : " active"}`}
          aria-current={pinsOpen ? undefined : "page"}
          onClick={onChannel}
        >
          <Hash />
          <span>Channel</span>
        </button>
        <button
          className={`nav-row${pinsOpen ? " active" : ""}`}
          aria-current={pinsOpen ? "page" : undefined}
          onClick={onPins}
        >
          <Pin />
          <span>Pins</span>
        </button>
      </nav>
    </aside>
  );
}
