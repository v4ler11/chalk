import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { SettingsApp } from "./SettingsApp";
import { LogsApp } from "./LogsApp";
import { installLogCapture } from "./logs";
import "katex/dist/katex.min.css";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/newsreader";

// One bundle serves every window; the settings and log windows are declared with
// `?view=…` in tauri.conf.json.
const view = new URLSearchParams(window.location.search).get("view");

// Only the window that draws the log collects entries for it.
if (view === "logs") installLogCapture();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {view === "settings" ? <SettingsApp /> : view === "logs" ? <LogsApp /> : <App />}
  </React.StrictMode>,
);
