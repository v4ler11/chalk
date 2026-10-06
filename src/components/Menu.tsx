import { useState, type AriaRole, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { Check } from "lucide-react";

/**
 * Which of a bar's menus is open, if any. Opening one gives up whichever other
 * was open, so no two are ever drawn at once; pressing the control that opened
 * a menu a second time gives that same one up, which is what a control that is
 * both the way in and the way out has to do.
 */
export function useOpenMenu<K extends string>() {
  const [open, setOpen] = useState<K | null>(null);
  const toggle = (which: K) => setOpen((current) => (current === which ? null : which));
  const close = () => setOpen(null);
  return { open, toggle, close };
}

interface MenuProps {
  /**
   * The control the menu hangs from. Given one, the menu is drawn at the
   * window's edge and placed from that control's own rect, which is what the
   * composer's menus need: the bar they sit in clips whatever would hang out of
   * it. Left out, the menu is drawn where it stands instead, for a control
   * inside a positioned box (the nav's three-dots) whose stylesheet hangs the
   * menu off that box.
   */
  anchor?: RefObject<HTMLElement | null>;
  /** What the menu is called on its own, beside the `menu` class they all wear. */
  className: string;
  /** What the menu is to the accessibility tree: a set of choices, or a group. */
  role: AriaRole;
  /** The id a control points at with `aria-controls`. */
  id?: string;
  /** What the menu is, for the menus whose role does not say it. */
  label?: string;
  /** Gives the menu up, which is what a click anywhere else asks for. */
  onClose: () => void;
  children: ReactNode;
}

/**
 * A menu hung from the control that opened it: the models, the reasoning levels
 * and the servers under the composer's bar, and the nav's view switches under
 * its three-dots. It owns the whole of the plumbing: the portal that keeps it
 * out of the card, the control it is placed from, the backdrop, and the click
 * that gives it up.
 *
 * The backdrop is the close: it is drawn with the menu rather than listened for
 * on the window, so nothing outlives the menu and the click that closes one
 * never reaches what it landed on.
 */
export function Menu({ anchor, className, role, id, label, onClose, children }: MenuProps) {
  // Where the menu hangs, read from its control as the menu is drawn. A menu is
  // mounted when it is opened and unmounted when it is closed, so this runs once
  // per opening, which is also the moment that control's rect is the one to
  // place it from: the control does not move while its menu is up.
  const [place] = useState(() => {
    const el = anchor?.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return { left: rect.left, bottom: window.innerHeight - rect.top + 6 };
  });

  const drawn = (
    <>
      <div className="menu-backdrop" onClick={onClose} />
      <div
        id={id}
        className={`menu${anchor ? "" : " below"} ${className}`}
        role={role}
        aria-label={label}
        style={place ?? undefined}
      >
        {children}
      </div>
    </>
  );

  // A menu with a control is placed from that control's rect, so it is held at
  // the window rather than inside whatever box the control sits in.
  return anchor ? createPortal(drawn, document.body) : drawn;
}

interface MenuOptionProps {
  /** What the row says. */
  label: string;
  /** The row is the one in force: it is marked, and a check sits at its end. */
  selected?: boolean;
  /**
   * What the row is to the accessibility tree. A radio and a switch are read as
   * checked or not; a listbox's option as selected, which is the same fact under
   * the name its list's role puts on it; a plain command is neither, so no state
   * is claimed of it.
   */
  role: "menuitemradio" | "menuitemcheckbox" | "option" | "menuitem";
  /** The shortcut bound to the row, named beside its words as the rail names
   *  the shortcuts of its own buttons. */
  shortcut?: string;
  onClick: () => void;
}

/**
 * One row of a menu: what it says, the shortcut bound to it if any, and a check
 * while it is the one in force. The three menus of the composer's bar and the
 * nav's are all drawn out of these.
 */
export function MenuOption({ label, selected = false, role, shortcut, onClick }: MenuOptionProps) {
  // A radio and a checkbox are read as checked or not, an option as selected or
  // not. A plain command carries no state at all, under either name.
  const state =
    role === "option"
      ? { "aria-selected": selected }
      : role === "menuitem"
        ? {}
        : { "aria-checked": selected };

  return (
    <button
      className={`menu-option${selected ? " active" : ""}`}
      role={role}
      {...state}
      onClick={onClick}
    >
      <span className="menu-option-name">{label}</span>
      {shortcut && <kbd>{shortcut}</kbd>}
      {selected && <Check className="menu-option-check" />}
    </button>
  );
}
