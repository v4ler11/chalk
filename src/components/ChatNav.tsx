import { ArrowLeft, EllipsisVertical } from "lucide-react";
import { MOD } from "../keybinds";
import { Hint } from "./Hint";
import { Menu, MenuOption, useOpenMenu } from "./Menu";

interface Props {
  /** Whether a thread is open. The way back to the feed belongs to the pane a
   *  thread puts up, so it is part of that pane's bar and travels with it, and
   *  the JSON view is a thread's own: a channel's menu does not offer it. */
  thread: boolean;
  /** The way back to the feed, which exists only while a thread is open. */
  onBack: () => void;
  /** Whether the plain-JSON view is standing in for the transcript. */
  jsonView: boolean;
  onJsonView: (on: boolean) => void;
  /** What a pane that has taken the window over is called: the settings, the
   *  JSON view. A mode is not a thread, so its name and its way out stand on
   *  this same strip — one bar across the pane, the way every pane has one. */
  title?: string;
  /** Leaves the mode, from the red ESC at the strip's right. */
  onClose?: () => void;
}

/**
 * The panel's own bar: the strip across the top of a pane, which drags the
 * window wherever the controls are not. It is drawn by each pane, so a thread's
 * bar arrives with the thread and leaves with it, and everything on it does the
 * same rather than appearing over a pane it does not belong to.
 *
 * The way back to the feed is at its left while a thread is open, and the
 * three-dots at its right, whose one item is the JSON view: that view is a
 * thread's own, so a bar belonging to anything else carries no menu rather than a
 * menu with nothing in it. The settings used to be an item here and are a row of
 * the window's own column now, with the panes they open among.
 *
 * A pane that has taken the window over wears the same strip and nothing more:
 * its name at the left and its way out at the right, rather than a second bar
 * under this one — the strip is the pane's own band, and a second one is a band
 * of its own for a name that belongs on this one.
 *
 * The model that used to be named here is in the composer now, beside the message
 * it applies to. The rule under this strip is what separates the bar from the
 * pane below it.
 */
export function ChatNav({ thread, onBack, jsonView, onJsonView, title, onClose }: Props) {
  const menus = useOpenMenu<"view">();
  const viewOpen = menus.open === "view";

  return (
    <div className="chat-nav" data-tauri-drag-region="deep">
      {/* What a pane that has taken the window over is: named at the strip's
          left, where a thread's way back stands, since it is the same kind of
          thing — what this pane is — and left by the red ESC at its right. */}
      {title !== undefined && (
        <>
          <span className="pane-title">{title}</span>
          <button className="btn btn--key btn--danger btn--danger-outline" onClick={onClose}>
            ESC
          </button>
        </>
      )}

      {/* What belongs to a thread is on its bar and nothing else is: the way back
          to the feed, and the dots holding the switches a thread has. Any other
          pane's bar is the strip alone — the window's drag region, and the rule
          under it. */}
      {thread && (
        <>
          {/* The way back, in the bar rather than in the window's corner: it
              belongs to the pane a thread puts up, so it travels with that
              pane. */}
          <Hint label={<>Channel <kbd>Esc</kbd></>} decorative>
            <button
              className="btn btn--quiet btn--icon"
              aria-label="Back to channel"
              onClick={onBack}
            >
              <ArrowLeft />
            </button>
          </Hint>

          <div className="nav-menu">
            <button
              className={`btn btn--quiet btn--icon${viewOpen ? " active" : ""}`}
              aria-haspopup="menu"
              aria-expanded={viewOpen}
              aria-label="Views"
              onClick={() => menus.toggle("view")}
            >
              <EllipsisVertical />
            </button>

            {viewOpen && (
              <Menu className="view-menu" role="menu" onClose={menus.close}>
                <MenuOption
                  label="JSON view"
                  selected={jsonView}
                  role="menuitemcheckbox"
                  shortcut={`${MOD}J`}
                  onClick={() => {
                    onJsonView(!jsonView);
                    menus.close();
                  }}
                />
              </Menu>
            )}
          </div>
        </>
      )}
    </div>
  );
}
