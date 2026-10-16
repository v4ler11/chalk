import { TrafficLights } from "./WindowControls";

/**
 * The window's own title bar: the controls, drawn in the webview because the
 * window is frameless, and the region that drags it.
 *
 * It carries the window's own controls and nothing else. The settings are the
 * foot row of the window's own column and the way back to the feed is on the bar
 * a thread draws, so that both travel with the column or the pane each belongs
 * to. The panel beneath reserves the same strip, so the two read as one band.
 */
export function TitleBar() {
  return (
    // "deep", so every pixel of the rail drags — its padding and the gaps
    // between the controls included — while the buttons themselves still take
    // their clicks, which Tauri's drag region skips over.
    <header className="rail" data-tauri-drag-region="deep">
      <TrafficLights />
    </header>
  );
}
