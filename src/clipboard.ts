/**
 * Writes text to the clipboard.
 *
 * The async clipboard needs a secure context, so where it is unavailable — or
 * refuses the write — the old selection copy is the fallback: a click that
 * quietly does nothing is worse than a deprecated call. The answer is whether
 * the text landed, which is what a button has to say about itself.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    const copied = document.execCommand("copy");
    area.remove();
    return copied;
  }
}
