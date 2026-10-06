import type { ReactNode } from "react";

interface Props {
  /** The control the tip belongs to: a button, or the pill a pair of them makes. */
  children: ReactNode;
  /** What the tip says under the pointer. It may name a shortcut beside its
   *  words, which is why it is not only text. */
  label: ReactNode;
  /**
   * The tip is decoration: the control already says what it does on its own, so
   * a screen reader is left with the control rather than with the same words
   * twice. A tip on the bar of a pane is read this way, since it is there for
   * the pointer and the shortcut it names is no part of what the control is.
   */
  decorative?: boolean;
}

/**
 * A control with its tip under it: what the control does, drawn under the
 * pointer as a tip of the app's own, since the window draws its own chrome and
 * has no native ones. What the tip says is the label, and everything the tip
 * belongs to (the button, or the pill of two) is the control it is drawn
 * against, so the two are never written out separately.
 *
 * The tip is out of the flow, so the row it stands in is the same width whether
 * or not it is drawn, and it takes no clicks, so it never stands between the
 * pointer and the control it belongs to. Where it is drawn is the stylesheet's
 * business: under the control, except in the composer, whose row is the last of
 * the window and which lifts its tips above it.
 */
export function Hint({ children, label, decorative = false }: Props) {
  return (
    <div className="hint">
      {children}
      <span className="key-hint" aria-hidden={decorative ? true : undefined}>
        {label}
      </span>
    </div>
  );
}
