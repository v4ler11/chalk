import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow, type Window as AppWindow } from "@tauri-apps/api/window";

/** Runs a window command against the window this webview belongs to. */
function windowCommand(run: (win: AppWindow) => Promise<void>) {
  if (!isTauri()) return;
  // Failures are logged rather than swallowed: the log panel is where a refused
  // or missing window permission would otherwise go unnoticed.
  run(getCurrentWindow()).catch((e) => console.error("window command failed:", e));
}

/** The window's traffic lights. They drive whichever window holds them. */
export function TrafficLights() {
  return (
    <div className="traffic-lights">
      <button
        className="light close"
        title="Close"
        aria-label="Close window"
        onClick={() => windowCommand((win) => win.close())}
      />
      <button
        className="light min"
        title="Minimize"
        aria-label="Minimize window"
        onClick={() => windowCommand((win) => win.minimize())}
      />
      <button
        className="light max"
        title="Zoom"
        aria-label="Zoom window"
        onClick={() => windowCommand((win) => win.toggleMaximize())}
      />
    </div>
  );
}
