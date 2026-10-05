import { useState } from "react";
import { Check, EllipsisVertical } from "lucide-react";
import { MOD } from "../keybinds";

interface Props {
  /** Whether a thread is open. The JSON view is a thread's own — there is no
   *  request to show for a channel — so its menu is not offered without one. */
  thread: boolean;
  /** Whether the plain-JSON view is standing in for the transcript. */
  jsonView: boolean;
  onJsonView: (on: boolean) => void;
}

/**
 * The chat panel's own nav: the strip across the top of the panel, which drags
 * the window wherever the controls are not, and the three-dots at its right —
 * the window's view switches, which outlive the chat they are taken in.
 *
 * The model that used to be named here is in the composer now, beside the
 * message it applies to. The rule under this strip is what separates the nav
 * from the transcript below it.
 */
export function ChatNav({ thread, jsonView, onJsonView }: Props) {
  const [viewOpen, setViewOpen] = useState(false);

  return (
    <div className="chat-nav" data-tauri-drag-region="deep">
      {/* The view switches, of which there is one: the conversation as plain
          JSON instead of the transcript and the composer. It belongs to a thread
          rather than to the window now: a channel has no request to show, so
          there is nothing to switch to there. */}
      {thread && (
        <div className="nav-menu">
          <button
            className={`icon-btn${viewOpen ? " active" : ""}`}
            aria-haspopup="menu"
            aria-expanded={viewOpen}
            aria-label="View"
            onClick={() => setViewOpen((o) => !o)}
          >
            <EllipsisVertical className="icon" />
          </button>

          {viewOpen && (
            <>
              <div className="menu-backdrop" onClick={() => setViewOpen(false)} />
              <div className="menu below view-menu" role="menu">
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
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
