import type { McpTool } from "./types";

/**
 * One tool as the endpoint is sent it: a function, its name, the description it
 * has — an empty one is no description at all rather than an empty string — and
 * the JSON Schema of its arguments. The shape mirrors the backend's own
 * `ToolOffer::as_tool`, since that is what these bytes are counted against.
 */
function asTool(tool: McpTool) {
  return {
    type: "function",
    function: {
      name: tool.name,
      ...(tool.description === "" ? {} : { description: tool.description }),
      parameters: tool.parameters,
    },
  };
}

/**
 * What a set of tools costs a request, in bytes: the `tools` array as compact
 * UTF-8 JSON, over the shape the endpoint receives. The backend counts a
 * server's price the same way, so the two agree.
 */
export function toolBytes(tools: McpTool[]): number {
  return new TextEncoder().encode(JSON.stringify(tools.map(asTool))).length;
}

/**
 * A byte count as tokens: a token is about a quarter of the JSON they are sent
 * as, and anything worth thousands is rounded to one decimal — `4.3k`, `145`.
 */
export function tokens(bytes: number): string {
  const count = Math.round(bytes / 4);
  return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : `${count}`;
}

/**
 * Tool names and arguments, as the transcript shows them.
 *
 * A tool is named for the model — the server's id and the tool's own name,
 * joined by a double underscore so two servers cannot offer tools under one name
 * — and that name is an implementation detail of the app rather than something
 * to read. The id is the user's own to write, so the two halves are split apart
 * again for display.
 */
export function toolLabel(name?: string): string {
  if (!name) return "tool";
  return name.replace("__", " · ").replace(/_/g, " ");
}

/**
 * The two halves of a tool's name, as they were joined: the server's id and the
 * tool's own name.
 *
 * The transcript keeps them as the server wrote them — a call's row is a record
 * of an identifier being invoked, so the identifier is shown whole, underscores
 * and all — where the approval card reads them out in prose, which is what
 * `toolLabel` is for.
 */
export function toolParts(name?: string): { server: string; tool: string } {
  const [server, tool] = (name ?? "").split("__");
  return { server: server || "tool", tool: tool ?? "" };
}

/**
 * Arguments or a result laid out to be read: the JSON as it was sent or
 * answered, indented. What is not JSON — a fragment, an answer that is prose —
 * is shown as it arrived, which is more use than an empty box.
 */
export function laidOut(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

/**
 * The same, on one line. A model's arguments are usually one dense line already;
 * when they are not, the row they are shown in is, so the newlines are folded
 * into spaces rather than left for the layout to collapse.
 */
export function oneLine(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text));
  } catch {
    return text.replace(/\s+/g, " ").trim();
  }
}
