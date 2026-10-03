import { useEffect, useRef, useState } from "react";
import type { AppConfig } from "./types";
import * as api from "./api";
import { SettingsPanel } from "./components/SettingsPanel";
import { TrafficLights } from "./components/WindowControls";
import "./App.css";

/** How long the receipt for a save stays on screen, in milliseconds. */
const SAVED_MS = 2000;

/**
 * The settings window: the app's own window chrome, then the config form, which
 * is divided into sections by a sidebar of its own. It is a separate window so
 * the transcript is never covered by it, and the same bundle serves it — the
 * main window loads without `?view=settings`. The log lives in its own window,
 * which the button at the foot of that sidebar shows.
 */
export function SettingsApp() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState("");
  // Set by a save and cleared by the next edit or by its own timer: it is a
  // receipt for what just happened, not a state the form is in.
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  useEffect(() => {
    api
      .getConfig()
      .then(setConfig)
      .catch((e) => setError(String(e)));
    return stopSavedTimer;
  }, []);

  /** Clears the receipt, and the timer that would have cleared it. */
  function stopSavedTimer() {
    if (savedTimer.current !== null) {
      window.clearTimeout(savedTimer.current);
      savedTimer.current = null;
    }
  }

  /** Shows the receipt for a moment, then takes it away again. */
  function flashSaved() {
    stopSavedTimer();
    setSaved(true);
    savedTimer.current = window.setTimeout(() => {
      savedTimer.current = null;
      setSaved(false);
    }, SAVED_MS);
  }

  async function save() {
    if (!config) return;
    try {
      setConfig(await api.saveConfig(config));
      setError("");
      flashSaved();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="app">
      <header className="settings-bar" data-tauri-drag-region="deep">
        <TrafficLights />
        <span className="settings-title">Settings</span>
      </header>

      <div className="settings-body">
        {config ? (
          <SettingsPanel
            config={config}
            saved={saved}
            notice={error !== "" ? <p className="notice">Error: {error}</p> : undefined}
            onChange={(patch) => {
              // An edit makes the receipt a lie the moment it is typed.
              stopSavedTimer();
              setSaved(false);
              setConfig((c) => (c ? { ...c, ...patch } : c));
            }}
            onSave={save}
            onOpenLogs={api.openLogs}
          />
        ) : (
          // Nothing to configure until the file has been read: the log window is
          // still reachable, and a failure is still worth reading.
          <div className="settings-empty">
            {error !== "" && <p className="notice">Error: {error}</p>}
            <button className="settings-open-logs" onClick={api.openLogs}>
              Logs
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
