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
 *
 * A name with no double underscore in it is not a server's tool: the loader and
 * the eight tools the app answers itself are named on their own, with no server
 * on them, so the whole name is the tool being called and there is nothing to
 * stand before the separator. Splitting one of those on a join it never had is
 * what leaves a separator with an empty half after it, and the arguments reading
 * as the half that was cut off.
 */
export function toolParts(name?: string): { server: string; tool: string } {
  const whole = name ?? "";
  const cut = whole.indexOf("__");
  if (cut === -1) return { server: "", tool: whole || "tool" };
  return { server: whole.slice(0, cut), tool: whole.slice(cut + 2) };
}

/**
 * Whether a call's arguments are worth showing.
 *
 * A model that sends `{}` for a tool that takes nothing has said nothing, and a
 * row reading `{}` for it is a row reading punctuation: the braces are the shape
 * of an answer, not the answer. An empty array is the same nothing. Anything
 * else — an object with a key in it, a value, or something that is not JSON at
 * all — is shown as it arrived.
 */
export function hasArguments(text?: string): boolean {
  if (text === undefined) return false;
  const trimmed = text.trim();
  if (trimmed === "") return false;
  try {
    const value: unknown = JSON.parse(trimmed);
    return !(value !== null && typeof value === "object" && Object.keys(value).length === 0);
  } catch {
    return true;
  }
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
