import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { McpCost, McpFailure, McpServer, McpTool } from "./types";
import * as api from "./api";

/**
 * The model context protocol servers and their tools, read on the way in and
 * again whenever the settings save a change.
 *
 * They are read here rather than per request because reading them starts
 * servers: the first read is what pays for that, and every request after it is
 * sent with what it found. A server that could not be reached is kept beside the
 * tools rather than raised as an error of the window.
 */
export function useServers(onError: (e: unknown) => void) {
  // The servers as `mcp.json` declares them, the pool of their tools, the ones
  // that could not be reached and what each server's tools cost a request.
  const [servers, setServers] = useState<McpServer[]>([]);
  const [tools, setTools] = useState<McpTool[]>([]);
  const [failures, setFailures] = useState<McpFailure[]>([]);
  const [costs, setCosts] = useState<McpCost[]>([]);
  // A read is in flight, which the composer's list shows and its Refresh asks for.
  const [reading, setReading] = useState(false);

  /**
   * `refresh` starts the connections over first, which is what the composer's
   * list presses for: a server says what it offers when it is connected to, so
   * asking it again means connecting again.
   */
  const readTools = useCallback(
    async (refresh = false) => {
      setReading(true);
      try {
        const [declared, found] = await Promise.all([api.mcpServers(), api.mcpTools(refresh)]);
        setServers(declared);
        setTools(found.tools);
        setFailures(found.failures);
        setCosts(found.costs);
      } catch (e) {
        onError(e);
      } finally {
        setReading(false);
      }
    },
    [onError],
  );

  useEffect(() => {
    readTools();

    let gone = false;
    let unlisten: (() => void) | undefined;
    listen("servers-changed", () => readTools()).then((fn) => {
      if (gone) fn();
      else unlisten = fn;
    });
    return () => {
      gone = true;
      unlisten?.();
    };
  }, [readTools]);

  return { servers, tools, failures, costs, reading, readTools };
}
