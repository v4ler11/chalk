import type { McpServer, McpTool } from "./types";
import { offeredServers } from "./components/ServersMenu";

/**
 * Lazily imported servers, as the window still reads them.
 *
 * The tools a request is sent, and the addendum its system prompt carries, are
 * assembled by the backend now — the run owns the turn, so it owns what the
 * turn is sent. What is left here is what the window itself draws: which of a
 * chat's lazy servers nobody can reach, so the transcript can say so, and how
 * the JSON view groups the request's tools.
 */

/**
 * What the import state is read against: the servers as `mcp.json` declares
 * them, the ones this chat calls, the ids it has loaded, and the ones that could
 * not be reached — a server nobody can reach cannot be loaded either.
 */
export interface LazyState {
  servers: McpServer[];
  chosen: string[] | null;
  loaded: string[];
  failed: string[];
}

/**
 * The lazily imported servers this chat calls and can reach: the ones it has
 * still to load, and the ones it has already loaded.
 */
export function lazyHere({ servers, chosen, failed }: LazyState): McpServer[] {
  const here = new Set(offeredServers(servers, chosen));
  return servers.filter(
    (server) => server.lazy && server.enabled && here.has(server.id) && !failed.includes(server.id),
  );
}

/**
 * The lazy servers this chat has still to load: the ones a failure on them is
 * not worth saying about, since none of what they hold is in the request yet.
 */
export function waiting(state: LazyState): McpServer[] {
  const open = new Set(state.loaded);
  return lazyHere(state).filter((server) => !open.has(server.id));
}

/** One server's tools, as the JSON view's Tools tab reads them. */
export interface ToolGroup {
  /** The server's id, or `""` for the app's own tools. */
  id: string;
  /** What the group is headed with: the server's name, or the app's. */
  name: string;
  tools: McpTool[];
}

/**
 * The tools a request carries, grouped by the server that offers them — the
 * app's own loader first, since it belongs to no server.
 *
 * What is grouped is the request's own list, and nothing else: a lazily imported
 * server that has not been loaded is not in the request, so it is not here
 * either — listing it would show the window's pool under the request's name.
 */
export function groupTools(tools: McpTool[]): ToolGroup[] {
  const byServer = new Map<string, McpTool[]>();
  for (const tool of tools) {
    const own = byServer.get(tool.server);
    if (own) own.push(tool);
    else byServer.set(tool.server, [tool]);
  }

  const groups: ToolGroup[] = [];
  for (const [id, own] of byServer) {
    groups.push({ id, name: own[0].serverName || (id === "" ? "Chalk" : id), tools: own });
  }
  // The loader belongs to the app, not to a server, so its group stands first.
  groups.sort((a, b) => (a.id === "" ? -1 : b.id === "" ? 1 : 0));
  return groups;
}
