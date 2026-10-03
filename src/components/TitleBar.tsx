import { PanelLeftClose, PanelLeftOpen, SquarePen } from "lucide-react";
import { MOD } from "../keybinds";
import { TrafficLights } from "./WindowControls";

interface Props {
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onNewChat: () => void;
}

/**
 * The window's own title bar: the controls, drawn in the webview because the
 * window is frameless, and the region that drags it.
 *
 * It is the sidebar's head — the same width and colour — so the two read as one
 * panel, and it sits at the top of the sidebar's own column, which leaves the
 * chat panel the full height of the window beside it.
 */
export function TitleBar({ sidebarOpen, onToggleSidebar, onNewChat }: Props) {
  return (
    // "deep", so every pixel of the rail drags — its padding and the gaps
    // between the controls included — while the buttons themselves still take
    // their clicks, which Tauri's drag region skips over.
    <header className="rail" data-tauri-drag-region="deep">
      <TrafficLights />

      <div className="window-actions">
        {/* Each button names itself and its shortcut under the pointer: with no
            menu bar, this is where a binding can be found. */}
        <span className="hint">
          <button
            className="icon-btn"
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            onClick={onToggleSidebar}
          >
            {sidebarOpen ? <PanelLeftClose className="icon" /> : <PanelLeftOpen className="icon" />}
          </button>
          <span className="key-hint" aria-hidden="true">
            {sidebarOpen ? "Hide sidebar" : "Show sidebar"} <kbd>{MOD}B</kbd>
          </span>
        </span>

        <span className="hint">
          <button className="icon-btn" aria-label="New chat" onClick={onNewChat}>
            <SquarePen className="icon" />
          </button>
          <span className="key-hint" aria-hidden="true">
            New chat <kbd>{MOD}N</kbd>
          </span>
        </span>
      </div>
    </header>
  );
}
