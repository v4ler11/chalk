import { ArrowLeft } from "lucide-react";
import { TrafficLights } from "./WindowControls";

interface Props {
  /** Whether a thread is open: the way back to the feed is only there for one. */
  thread: boolean;
  onBack: () => void;
}

/**
 * The window's own title bar: the controls, drawn in the webview because the
 * window is frameless, and the region that drags it.
 *
 * It carries the way back to the feed while a thread is open. The settings used
 * to be here, in the corner; they are in the panel's own three-dots now, with
 * the rest of the window's switches. The panel beneath reserves the same strip,
 * so the two read as one band.
 */
export function TitleBar({ thread, onBack }: Props) {
  return (
    // "deep", so every pixel of the rail drags — its padding and the gaps
    // between the controls included — while the buttons themselves still take
    // their clicks, which Tauri's drag region skips over.
    <header className="rail" data-tauri-drag-region="deep">
      <TrafficLights />

      <div className="window-actions">
        {/* Each button names itself and its shortcut under the pointer: with no
            menu bar, this is where a binding can be found. */}
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
      </div>
    </header>
  );
}
