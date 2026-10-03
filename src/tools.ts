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
