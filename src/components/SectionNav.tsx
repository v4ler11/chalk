import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

/** One row of a mode's own sidebar: what it opens, what it is called, and the
 *  mark it wears. */
export interface NavSection {
  id: string;
  label: string;
  icon: LucideIcon;
}

interface Props {
  /** What the list is, for a reader who cannot see it. */
  label: string;
  sections: NavSection[];
  /** The section that is open. */
  active: string;
  onSelect: (id: string) => void;
  /** Anything kept at the foot of the list. */
  footer?: ReactNode;
}

/**
 * The vertical list of sections a mode's pane is divided into: the settings'
 * own sidebar, and the JSON view's — the same rows and the same foot, so the
 * two modes are one interface with different sections in it. The way out is not
 * here: it is the bar above, which every taken-over pane draws.
 */
export function SectionNav({ label, sections, active, onSelect, footer }: Props) {
  return (
    <nav className="settings-nav" aria-label={label}>
      {sections.map(({ id, label: text, icon: Icon }) => (
        <button
          key={id}
          className={`settings-tab${id === active ? " active" : ""}`}
          aria-current={id === active ? "page" : undefined}
          onClick={() => onSelect(id)}
        >
          <Icon className="settings-tab-icon" />
          <span>{text}</span>
        </button>
      ))}

      <div className="settings-nav-spacer" />
      {footer}
    </nav>
  );
}
