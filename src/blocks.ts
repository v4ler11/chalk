/**
 * Splits an answer that is still arriving into the markdown blocks that have
 * settled and the one block that is still growing.
 *
 * A blank line ends a block, except inside a code fence, where blank lines are
 * content — splitting there would render the two halves as broken code until the
 * rest arrived. A blank line only counts once *something follows it*: the growing
 * block must never be frozen on the strength of a newline that might turn out to
 * be half of a pair.
 */
export function splitBlocks(text: string): { solid: string[]; tail: string } {
  const lines = text.split("\n");
  const solid: string[] = [];
  let current: string[] = [];
  /** The opening run of the code fence we are inside, if any. */
  let fence: string | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (fence === null) {
      const open = /^ {0,3}(`{3,}|~{3,})/.exec(line);
      if (open) {
        fence = open[1];
      } else if (i < lines.length - 1 && /^[ \t]*\r?$/.test(line)) {
        if (current.length > 0) solid.push(current.join("\n"));
        current = [];
        continue;
      }
    } else if (closes(line, fence)) {
      fence = null;
    }
    current.push(line);
  }

  return { solid, tail: current.join("\n") };
}

/** A closing fence: the same character, at least as long, and nothing else. */
function closes(line: string, open: string): boolean {
  const close = /^ {0,3}(`{3,}|~{3,})[ \t]*\r?$/.exec(line);
  return close !== null && close[1][0] === open[0] && close[1].length >= open.length;
}
