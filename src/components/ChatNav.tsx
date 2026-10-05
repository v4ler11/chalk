import { useState } from "react";
import { ArrowLeft, Check, EllipsisVertical } from "lucide-react";
import { MOD } from "../keybinds";

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
  const [viewOpen, setViewOpen] = useState(false);

  return (
    <div className="chat-nav" data-tauri-drag-region="deep">
      {/* The way back, in the bar rather than in the window's corner: it belongs
          to the pane a thread puts up, so it travels with that pane. */}
      {thread && (
        <span className="hint">
          <button className="icon-btn" aria-label="Back to channel" onClick={onBack}>
            <ArrowLeft className="icon" />
          </button>
          <span className="key-hint" aria-hidden="true">
            Channel <kbd>Esc</kbd>
          </span>
        </span>
      )}

      <div className="nav-menu">
        <button
          className={`icon-btn${viewOpen ? " active" : ""}`}
          aria-haspopup="menu"
          aria-expanded={viewOpen}
          aria-label="View and settings"
          onClick={() => setViewOpen((o) => !o)}
        >
          <EllipsisVertical className="icon" />
        </button>

        {viewOpen && (
          <>
            <div className="menu-backdrop" onClick={() => setViewOpen(false)} />
            <div className="menu below view-menu" role="menu">
              {thread && (
                <button
                  className={`menu-option${jsonView ? " active" : ""}`}
                  role="menuitemcheckbox"
                  aria-checked={jsonView}
                  onClick={() => {
                    onJsonView(!jsonView);
                    setViewOpen(false);
                  }}
                >
                  <span className="menu-option-name">JSON view</span>
                  {/* The shortcut is named where its command lives, as the rail's
                      buttons name theirs. */}
                  <kbd>{MOD}J</kbd>
                  {jsonView && <Check className="menu-option-check" />}
                </button>
              )}
              <button
                className="menu-option"
                role="menuitem"
                onClick={() => {
                  onOpenSettings();
                  setViewOpen(false);
                }}
              >
                <span className="menu-option-name">Settings</span>
                <kbd>{MOD},</kbd>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
