import { useState, type ReactNode } from "react";
import { Check, Plus, X } from "lucide-react";

/**
 * A named field: the name above the control it names, which is how every form
 * on the settings surface is laid out. The wrapper is the same everywhere; the
 * control keeps the page's own class, since the pages dress their fields alike
 * but not identically.
 */
export function Field({
  label,
  className,
  children,
}: {
  label: string;
  /** The page's own class for the wrapper, where one field is laid out apart
      from the rest: the system prompt takes the page's whole height. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={className ? `field ${className}` : "field"}>
      <span>{label}</span>
      {children}
    </label>
  );
}

/**
 * The button that starts a new row of a list: the dashed pill under the models
 * and under the servers. The page's own class gives it its place; the caption
 * is left off where the button is only the icon.
 */
export function AddButton({
  className,
  label,
  title,
  ariaLabel,
  onClick,
}: {
  className: string;
  /** The caption beside the icon, where the button carries one. */
  label?: string;
  title?: string;
  /** What the button does, for the icon-only button, whose icon cannot say it. */
  ariaLabel?: string;
  onClick: () => void;
}) {
  return (
    <button
      className={`btn btn--dashed ${className}`}
      title={title}
      aria-label={ariaLabel}
      onClick={onClick}
    >
      <Plus />
      {label}
    </button>
  );
}

/**
 * The muted `X` that drops a row from a list the moment it is pressed. It is
 * what a model row and a header row both want; `RowDelete` is its opposite
 * number, the same icon, but one that asks its question before anything goes.
 */
export function IconButton({
  className,
  title,
  ariaLabel,
  disabled,
  onClick,
}: {
  className: string;
  title: string;
  ariaLabel: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={className}
      title={title}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
    >
      <X />
    </button>
  );
}

/**
 * A boolean field of the MCP form. The box is the app's own rather than the
 * platform's, since the platform draws its checkbox in colours that are not the
 * page's. The input keeps the click, the keyboard and the accessibility tree;
 * only the box beside it is drawn again.
 */
export function Checkbox({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="check-box" aria-hidden="true">{checked && <Check />}</span>
      <span>{label}</span>
    </label>
  );
}

/** Characters of a secret left in the clear while the field is not focused. */
const VISIBLE = 5;

/**
 * A secret's field: a key, a token, anything the page holds but does not show.
 *
 * The value is in the clear while the field has the caret, so it can be read and
 * corrected, and masked the rest of the time: its first five characters, then
 * one asterisk per character after them. A `type="password"` field is not used
 * for the mask — WebKit takes that glyph from the font, and no CSS keyword makes
 * it an asterisk (`-webkit-text-security` offers disc, circle and square only) —
 * so the mask is simply what the field holds while it is away from the caret.
 *
 * It is a control of the library rather than of a page because two pages hold
 * the same key: the General page, where requests are pointed, and the Models
 * page, where the models it pays for are listed.
 */
export function SecretInput({
  value,
  onChange,
  label = "API key",
  placeholder = "sk-...",
}: {
  value: string;
  onChange: (next: string) => void;
  /** What the field is announced as, where a page holds more than one secret. */
  label?: string;
  /** Shown while there is no key: the design's own example of one. */
  placeholder?: string;
}) {
  const [focused, setFocused] = useState(false);
  const masked = `${value.slice(0, VISIBLE)}${"*".repeat(Math.max(0, value.length - VISIBLE))}`;

  return (
    <input
      type="text"
      className="input"
      value={focused ? value : masked}
      placeholder={placeholder}
      // Held read-only away from the caret, so the mask can never be written
      // back as the key by a stray edit.
      readOnly={!focused}
      autoComplete="off"
      spellCheck={false}
      aria-label={label}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
