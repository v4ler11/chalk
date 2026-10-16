import { useLayoutEffect, type RefObject } from "react";

/**
 * The width the draft keeps clear at its right end for what sends it.
 *
 * The draft takes the card's whole width — which is what puts the card's one
 * scrollbar, the draft's, at the card's right edge — and the shortcut and the
 * button stand on the draft's own last line at that end, so the words must wrap
 * before them. How much to keep clear is the column's own width, measured here
 * into `--send-w` on the row: a wider shortcut, or one in another script, moves
 * the wrap with it rather than running under the button.
 *
 * It is measured in the render that mounts the row, before the browser has
 * painted anything, and followed after that by a resize report — the one thing
 * that changes the column's width on its own is the shortcut giving way to
 * Stop, and the report is what carries that.
 */
export function useSendRoom(column: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = column.current;
    const row = element?.parentElement;
    if (!element || !row) return;
    const measure = () => row.style.setProperty("--send-w", `${element.offsetWidth}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [column]);
}
