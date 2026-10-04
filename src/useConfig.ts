import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { AppConfig } from "./types";
import * as api from "./api";

/**
 * The config, read on the way in and again whenever it changes under the window:
 * the settings are edited in this window now, and a hand-edited file is still
 * possible, so the event is what keeps the chat asking with what was written.
 */
export function useConfig(onError: (e: unknown) => void) {
  const [config, setConfig] = useState<AppConfig | null>(null);

  /** Re-reads the config, which a save — or the file itself — rewrites in place. */
  const reload = useCallback(() => {
    api.getConfig().then(setConfig).catch(onError);
  }, [onError]);

  useEffect(reload, [reload]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    listen("config-changed", reload).then((fn) => {
      if (active) unlisten = fn;
      else fn();
    });

    return () => {
      active = false;
      unlisten?.();
    };
  }, [reload]);

  return { config, setConfig, reload };
}
