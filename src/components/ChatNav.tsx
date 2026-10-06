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
  /** Opens the settings, which take the panel in place of the chat. */
  onOpenSettings: () => void;
}

/**
 * The panel's own bar: the strip across the top of a pane, which drags the
 * window wherever the controls are not. It is drawn by each pane, so a thread's
 * bar arrives with the thread and leaves with it, and everything on it does the
 * same rather than appearing over a pane it does not belong to.
 *
 * The way back to the feed is at its left while a thread is open, and the
 * three-dots at its right — the window's switches and the settings, which belong
 * to no single chat. Of the menu's two items, the JSON view is a thread's own, so
 * a channel's menu holds the settings alone.
 *
 * The model that used to be named here is in the composer now, beside the message
 * it applies to. The rule under this strip is what separates the bar from the
 * pane below it.
 */
export function ChatNav({ thread, onBack, jsonView, onJsonView, onOpenSettings }: Props) {
  const menus = useOpenMenu<"view">();
  const viewOpen = menus.open === "view";

  return (
    <div className="chat-nav" data-tauri-drag-region="deep">
      {/* The way back, in the bar rather than in the window's corner: it belongs
          to the pane a thread puts up, so it travels with that pane. */}
      {thread && (
        <Hint label={<>Channel <kbd>Esc</kbd></>} decorative>
          <button className="icon-btn" aria-label="Back to channel" onClick={onBack}>
            <ArrowLeft className="icon" />
          </button>
        </Hint>
      )}

      <div className="nav-menu">
        <button
          className={`icon-btn${viewOpen ? " active" : ""}`}
          aria-haspopup="menu"
          aria-expanded={viewOpen}
          aria-label="View and settings"
          onClick={() => menus.toggle("view")}
        >
          <EllipsisVertical className="icon" />
        </button>

        {viewOpen && (
          <Menu className="view-menu" role="menu" onClose={menus.close}>
            {thread && (
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
            )}
            <MenuOption
              label="Settings"
              role="menuitem"
              shortcut={`${MOD},`}
              onClick={() => {
                onOpenSettings();
                menus.close();
              }}
            />
          </Menu>
        )}
      </div>
    </div>
  );
}
