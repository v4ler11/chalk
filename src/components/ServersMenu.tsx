import { RefreshCw } from "lucide-react";
import { tokens } from "../tools";
import type { McpCost, McpFailure, McpServer, McpTool } from "../types";

export interface ServersProps {
  /** The servers as `mcp.json` declares them — the list the settings window edits. */
  declared: McpServer[];
  /** Every enabled server's tools, as last read: what a row counts. */
  tools: McpTool[];
  /** The servers that could not be reached, and what they said instead. */
  failures: McpFailure[];
  /** What each server's tools cost a request, in bytes, as last read. */
  costs: McpCost[];
  /** A read of the tools is in flight. */
  reading: boolean;
  /** The servers this chat offers, or null while it has never chosen. */
  chosen: string[] | null;
  /** The ids of the servers this chat has loaded. For a lazily imported server
   *  that is the whole of what its row says: not loaded is what lazy means. */
  loaded: string[];
  onChoose: (ids: string[] | null) => void;
  /** Asks every server again, connecting afresh. */
  onRefresh: () => void;
}

/**
 * The servers a chat offers: every enabled one while it has never chosen, and
 * otherwise the ones it kept — never one the settings window has switched off,
 * since a server that is not started has nothing for a chat to call.
 *
 * One rule for one question, written once: the list draws it and the composer
 * counts it, and a chat that is sent a server the list shows as off — or shown
 * one it is not sent — would be two answers to the same thing.
 */
export function offeredServers(declared: McpServer[], chosen: string[] | null): string[] {
  const enabled = declared.filter((server) => server.enabled);
  return chosen === null
    ? enabled.map((server) => server.id)
    : chosen.filter((id) => enabled.some((server) => server.id === id));
}

/**
 * The model context protocol servers the open chat may call, under the
 * composer's tools control: a switch for each, and a button that asks them all
 * again.
 *
 * Only the enabled servers are listed. One switched off in the settings window
 * is never started, so there is nothing for a chat to switch on, and its row
 * would be a switch that cannot be moved. The choice itself is the chat's — the
 * reason there is no way into the settings from here: a server's declaration is
 * edited there, and whether *this conversation* is sent with it is decided here,
 * one switch at a time.
 */
export function ServersMenu({
  declared,
  tools,
  failures,
  costs,
  reading,
  chosen,
  loaded,
  onChoose,
  onRefresh,
}: ServersProps) {
  const enabled = declared.filter((server) => server.enabled);
  const offered = offeredServers(declared, chosen);

  /**
   * Switches one server on or off for this chat. The first switch is what turns
   * a chat's silence into a choice, so it writes every id down rather than the
   * one that was pressed: an empty set means none, and only a written set means
   * "these".
   */
  function toggle(id: string) {
    onChoose(offered.includes(id) ? offered.filter((kept) => kept !== id) : [...offered, id]);
  }

  return (
    <>
      {enabled.map((server) => {
        const count = tools.filter((tool) => tool.server === server.id).length;
        const bytes = costs.find((cost) => cost.server === server.id)?.bytes ?? 0;
        const failure = failures.find((failed) => failed.server === server.id);
        // A lazily imported server this chat has not loaded is one it is not sent
        // at all: no count is a number it spends. A server that could not be
        // reached is not a lazy one to this row either — the failure is what it
        // has to say, and it says it in red rather than in the blue of lazy.
        const lazy = !failure && !reading && server.lazy && !loaded.includes(server.id);
        // What the row has to say about itself: how much the server offers and
        // what it costs, that it is not loaded yet, that it could not be reached,
        // or that it is still being asked — never a count that has not arrived.
        const note = failure
          ? "Could not be reached"
          : reading
            ? "Asking…"
            : lazy
              ? "lazy"
              : `${count === 1 ? "1 tool" : `${count} tools`}${
                  count === 0 ? "" : ` ~${tokens(bytes)} Tok`
                }`;
        return (
          <button
            key={server.id}
            className="menu-server"
            aria-pressed={offered.includes(server.id)}
            onClick={() => toggle(server.id)}
          >
            <span className="menu-server-text">
              <span className="menu-server-name">{server.name}</span>
              <span className={`menu-server-count${failure ? " failed" : ""}${lazy ? " lazy" : ""}`}>
                {note}
              </span>
            </span>
            <span className="switch" aria-hidden="true" />
          </button>
        );
      })}
      {enabled.length === 0 && (
        <p className="menu-note">No servers are enabled. Add one in the settings.</p>
      )}
      <button className="menu-refresh" disabled={reading} onClick={onRefresh}>
        <RefreshCw className={reading ? "spinning" : undefined} />
        Refresh tools
      </button>
    </>
  );
}
