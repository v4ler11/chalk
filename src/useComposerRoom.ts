import { useLayoutEffect, type RefObject } from "react";

/**
 * The room a pane keeps for the composer floating over it.
 *
 * The composer is drawn over the pane rather than standing under it, so a draft
 * growing into another line changes the composer's own box and nothing else: the
 * feed or the transcript behind it is never pushed up, pulled down or laid out
 * again, and the reader typing a second line is not moved by their own typing.
 * What the pane does instead is leave room for the bar — its own height, and a
 * little air above the content's end — measured here into `--composer-h`, which
 * the pane's content and its ↓ button read.
 *
 * The property is set on the bar's own parent, which is the pane the bar stands
 * in, so everything in that pane reads it and the two panes never share one.
 *
 * It is measured in the render that mounts the bar, before the browser has
 * painted anything, and followed after that by a resize report. A report lands a
 * frame after the growth it reports, and what that costs is the air under the
 * last line for that one frame: the content itself is never covered by it.
 */
export function useComposerRoom(bar: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const element = bar.current;
    const pane = element?.parentElement;
    if (!element || !pane) return;
    const measure = () => pane.style.setProperty("--composer-h", `${element.offsetHeight}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [bar]);
}
