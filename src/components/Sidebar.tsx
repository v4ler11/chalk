import { Hash, Pin, Settings2 } from "lucide-react";
import { Hint } from "./Hint";
import { MOD } from "../keybinds";

interface Props {
  /** Which of the column's rows the window is showing: one of the two views, or
   *  the settings, which stand in for them. */
  view: "channel" | "pins" | "settings";
  onChannel: () => void;
  onPins: () => void;
  onSettings: () => void;
}

/**
 * The window's own column: what there is to look at, one row each — the channel
 * the threads rest in, the pins gathered out of all of them, and the settings at
 * the foot of the column.
 *
 * It is narrow, and it is there in every view: a thread is opened *in* the
 * channel rather than instead of it, so the column that says which of them is
 * showing must not come and go with the pane. Its head is where the window's
 * chrome sits, which is why the column is as wide as it is.
 *
 * The settings are a row of this column rather than an item of the nav's menu:
 * what the window can show is one list, and a command that opens a pane belongs
 * with the panes. The row sits at the foot, apart from the two the chat lives
 * in, since it is the one that is not a place the chat is.
 */
export function Sidebar({ view, onChannel, onPins, onSettings }: Props) {
  const channel = view === "channel";
  const pins = view === "pins";
  const settings = view === "settings";

  return (
    <aside className="sidebar">
      <nav className="sidebar-list" aria-label="Views">
        <button
          className={`nav-row${channel ? " active" : ""}`}
          aria-current={channel ? "page" : undefined}
          onClick={onChannel}
        >
          <Hash />
          <span>Channel</span>
        </button>
        <button
          className={`nav-row${pins ? " active" : ""}`}
          aria-current={pins ? "page" : undefined}
          onClick={onPins}
        >
          <Pin />
          <span>Pins</span>
        </button>
      </nav>

      <nav className="sidebar-list sidebar-foot" aria-label="Window">
        <Hint decorative label={<>Settings <kbd>{MOD},</kbd></>}>
          <button
            className={`nav-row${settings ? " active" : ""}`}
            aria-current={settings ? "page" : undefined}
            onClick={onSettings}
          >
            <Settings2 />
            <span>Settings</span>
          </button>
        </Hint>
      </nav>
    </aside>
  );
}
