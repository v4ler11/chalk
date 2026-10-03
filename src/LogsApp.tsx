import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { pushBackendLogs, type LogEntry } from "./logs";
import * as api from "./api";
import { LogsPanel } from "./components/LogsPanel";
import { TrafficLights } from "./components/WindowControls";
import "./App.css";

/**
 * The log window: the app's own window chrome, then the log filling what is
 * left. It is a window of its own so the log can be left open beside the chat,
 * and the same bundle serves it — the main window loads without `?view=logs`.
 */
export function LogsApp() {
  // Backfill the backend log buffer, then follow it live.
  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    api.getLogs().then(pushBackendLogs).catch(() => {});
    listen<LogEntry>("app-log", (event) => pushBackendLogs([event.payload])).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  return (
    <div className="app">
      <header className="settings-bar" data-tauri-drag-region="deep">
        <TrafficLights />
        <span className="settings-title">Logs</span>
      </header>

      <div className="settings-body logs-body">
        <LogsPanel />
      </div>
    </div>
  );
}
