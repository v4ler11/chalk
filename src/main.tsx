import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { LogsApp } from "./LogsApp";
import { installLogCapture } from "./logs";
import "katex/dist/katex.min.css";
import "@fontsource-variable/space-grotesk";
import "@fontsource-variable/dm-sans";
import "@fontsource-variable/newsreader";

// One bundle serves both windows; the log window is declared with `?view=logs`
// in tauri.conf.json. Settings is not a window of its own — it is a mode of the
// chat window — so this bundle no longer has a page for it.
const view = new URLSearchParams(window.location.search).get("view");

// Only the window that draws the log collects entries for it.
if (view === "logs") installLogCapture();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {view === "logs" ? <LogsApp /> : <App />}
  </React.StrictMode>,
);
