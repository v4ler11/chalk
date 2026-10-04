import type { LazyServer, McpServer, McpTool } from "./types";
import { offeredServers } from "./components/ServersMenu";

/**
 * Lazily imported servers: the ones a chat is not sent the tools of.
 *
 * A server declared `lazy` is still started and still read — what it holds back
 * is its tools. All the model is given is its name and a description, in the
 * system prompt, and the `load_lazy_mcp` tool to ask for it by.
 *
 * Loading it puts its tools into the conversation like any other server's, and
 * there they stay. Activation is one-way: a server is imported for the rest of
 * the thread that asked for it, so the model is never left guessing whether the
 * tool it called a moment ago is still there, and nothing it does quietly takes
 * a tool away from it.
 */

/** The name the model calls to bring a lazy server's tools into the chat. */
export const LOAD_TOOL_NAME = "load_lazy_mcp";

/** What a server id is worth where a name is wanted. */
const call = (server: McpServer) => server.name || server.id;

/**
 * A name as it is compared: what a model may case or space differently.
 */
function name_less(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * The tool that does the loading.
 *
 * It belongs to the app rather than to any server — no server offered it — so it
 * is spelled here, once, and it is run without asking: it costs nothing, reaches
 * nothing, and does nothing but widen what the model may call next.
 */
export const LOAD_TOOL: McpTool = {
  name: LOAD_TOOL_NAME,
  server: "",
  serverName: "",
  title: "Load a lazily imported MCP server",
  description:
    "Load the tools of a lazily imported MCP server into this conversation, so they can be " +
    "called. Call it with the server's name as listed under Lazy Imported MCPs in the system " +
    "prompt, once you need what that server offers.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "The name of the lazily imported server to load." },
    },
    required: ["name"],
  },
  autoRun: true,
};

/**
 * What the import state is read against: the servers as `mcp.json` declares
 * them, the ones this chat calls, the ids it has loaded, and the ones that could
 * not be reached — a server nobody can reach cannot be loaded either, so it is
 * not offered to the model as a thing it could ask for.
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
 *
 * The loader is offered while any of them is here — loaded or not — so a server
 * this chat loaded stays callable by name for the rest of the thread, and the
 * tool does not vanish the moment the last one is loaded. What the loader does
 * with an already-loaded one is nothing: the load is one-way, and saying it is
 * loaded is the whole of the answer.
 */
export function lazyHere({ servers, chosen, failed }: LazyState): McpServer[] {
  const here = new Set(offeredServers(servers, chosen));
  return servers.filter(
    (server) => server.lazy && server.enabled && here.has(server.id) && !failed.includes(server.id),
  );
}

/**
 * The lazy servers this chat has still to load: the ones the prompt lists and
 * the ones the loader is offered for.
 */
export function waiting(state: LazyState): McpServer[] {
  const open = new Set(state.loaded);
  return lazyHere(state).filter((server) => !open.has(server.id));
}

/**
 * The tools a request is sent: the chosen servers' tools, with the lazy ones
 * among them left out until this chat has loaded them — and the loader itself
 * while any lazy server is still waiting to be asked for.
 */
export function toolsFor(state: LazyState, tools: McpTool[]): McpTool[] {
  const { servers, chosen, loaded } = state;
  const here = new Set(offeredServers(servers, chosen));
  const open = new Set(loaded);
  const lazy = new Set(servers.filter((server) => server.lazy).map((server) => server.id));
  const sent = tools.filter((tool) => here.has(tool.server) && (!lazy.has(tool.server) || open.has(tool.server)));
  return lazyHere(state).length === 0 ? sent : [...sent, LOAD_TOOL];
}

/**
 * What the system prompt is told about this chat's lazy servers: each one that
 * is still waiting, named and described, since the model has none of its tools
 * to read instead — and with the names of those tools, which cost a line where
 * their definitions would cost the whole weight the laziness is saving.
 *
 * The names are the ones the model will call, as the request spells them
 * (`<id>__<tool>`), so what it reads here and what appears once it loads the
 * server are the same names.
 */
export function promptFor(state: LazyState, tools: McpTool[]): LazyServer[] {
  return waiting(state).map((server) => ({
    name: call(server),
    description: server.description,
    tools: tools.filter((tool) => tool.server === server.id).map((tool) => tool.name),
  }));
}

/**
 * The server a `load_lazy_mcp` call names, or `null` when it names nothing this
 * chat may load. The model is given the server's name, so that is what is met
 * first; the id is met too, because it is the half of every tool name and is
 * what a model that has read the transcript rather than the prompt may say.
 */
export function loadable(state: LazyState, wanted: string): McpServer | null {
  const asked = name_less(wanted);
  // Loaded or not: a server this chat already loaded is one the loader answers
  // for, since answering nothing would read as a server that does not exist.
  const list = lazyHere(state);
  return (
    list.find((server) => name_less(call(server)) === asked) ??
    list.find((server) => name_less(server.id) === asked) ??
    null
  );
}

/** The same list with `server` loaded. Once loaded it stays loaded, so a second
    load of the same server changes nothing. */
export function withLoaded(loaded: string[], server: string): string[] {
  return loaded.includes(server) ? loaded : [...loaded, server];
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
 * What the model is told about it is the prompt's own addendum, which the
 * History tab shows.
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
