import { useEffect, useState } from "react";
import type { AppConfig } from "../types";
import * as api from "../api";
import { useSaved } from "../useSaved";
import { SettingsPanel } from "./SettingsPanel";

interface Props {
  /** The config as the window last read it: the draft starts from it, and is
   *  reset to it whenever it changes under the form. */
  config: AppConfig;
  /** Takes up what was just saved, so the window stops asking with the old one. */
  onSaved: (config: AppConfig) => void;
}

/**
 * The settings, standing in the chat's place in the window itself: the sections
 * and the form, exactly as the separate window held them, minus that window's
 * chrome.
 *
 * The form edits a draft rather than the window's config, so a half-typed model
 * or key never reaches a request: Save writes it and hands it back, and the
 * window takes it up. A config that changes under the form — the save's own
 * round trip, or the file edited by hand and re-read — is taken up too, since it
 * is then the one that is true.
 */
export function SettingsView({ config, onSaved }: Props) {
  const [draft, setDraft] = useState(config);
  const [error, setError] = useState("");
  // Set by a save and cleared by the next edit or by its own timer: it is a
  // receipt for what just happened, not a state the form is in.
  const { saved, flash, clear } = useSaved();

  useEffect(() => setDraft(config), [config]);

  async function save() {
    try {
      onSaved(await api.saveConfig(draft));
      setError("");
      flash();
    } catch (e) {
      setError(String(e));
    }
  }

  return (
    <div className="settings-body">
      <SettingsPanel
        config={draft}
        saved={saved}
        notice={error !== "" ? <p className="notice">Error: {error}</p> : undefined}
        onChange={(patch) => {
          // An edit makes the receipt a lie the moment it is typed.
          clear();
          setDraft((current) => ({ ...current, ...patch }));
        }}
        onSave={save}
        onOpenLogs={api.openLogs}
      />
    </div>
  );
}
