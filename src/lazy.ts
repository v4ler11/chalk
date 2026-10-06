import type { McpFailure, McpServer, McpTool } from "./types";

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
interface LazyState {
  servers: McpServer[];
  chosen: string[] | null;
  loaded: string[];
  failed: string[];
}

/** The servers that are switched on at all: one not started has nothing to call. */
export function enabledServers(declared: McpServer[]): McpServer[] {
  return declared.filter((server) => server.enabled);
}

/**
 * The servers a chat offers: every enabled one while it has never chosen, and
 * otherwise the ones it kept — never one the settings window has switched off,
 * since a server that is not started has nothing for a chat to call.
 *
 * One rule for one question, written once: the menu lists them, the composer
 * counts them, and the transcript says which of them nobody can reach; a chat
 * sent a server the list shows as off, or shown one it is not sent, would be two
 * answers to the same thing.
 */
export function offeredServers(declared: McpServer[], chosen: string[] | null): string[] {
  const enabled = enabledServers(declared);
  return chosen === null
    ? enabled.map((server) => server.id)
    : chosen.filter((id) => enabled.some((server) => server.id === id));
}

/**
 * The lazily imported servers this chat calls and can reach: the ones it has
 * still to load, and the ones it has already loaded.
 */
function lazyHere({ servers, chosen, failed }: LazyState): McpServer[] {
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

/**
 * What to say about the servers the open thread calls that nobody can reach.
 *
 * A failure on one of them is worth reading, since its tools are absent from the
 * request and an absence is not a reason. A lazy server that was never loaded is
 * outside this: none of what it holds is in the request by design, so its
 * failure is not the request's.
 */
export function unreachableServers(
  servers: McpServer[],
  chosen: string[] | null,
  loaded: string[],
  failures: McpFailure[],
): string {
  const unloaded = new Set(
    waiting({ servers, chosen, loaded, failed: failures.map((failure) => failure.server) }).map(
      (server) => server.id,
    ),
  );
  return failures
    .filter((failure) => !unloaded.has(failure.server))
    .filter((failure) => offeredServers(servers, chosen).includes(failure.server))
    .map((failure) => `${failure.name || failure.server}: ${failure.message}`)
    .join("\n");
}

/** One server's tools, as the JSON view's Tools tab reads them. */
interface ToolGroup {
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
