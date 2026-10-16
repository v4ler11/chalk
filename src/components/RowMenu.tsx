import type { ReactNode } from "react";

/**
 * What a row offers while the pointer is in it: the app's menu dressed as a pill
 * rather than a list, standing at the row's own top-right corner. That corner is
 * empty in every row that wears one — a thread's face and words are at its left,
 * and a prompt's head line is at the left of the line the pill covers — so the
 * pill is out of the flow, and the row is the height it would be without it.
 *
 * The channel's threads put pinning and deleting in it, and a prompt in the
 * transcript puts copying, asking again and rewriting there: one component, so
 * the two corners cannot come to disagree about the shape. Where the corner
 * stands belongs to the sheet of the row the pill is in, since a row is what
 * knows where its own corner is.
 */
export function RowMenu({ children }: { children: ReactNode }) {
  return <div className="menu menu--row row-menu">{children}</div>;
}
