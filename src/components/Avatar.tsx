/**
 * One face in the channel, as Slack draws them: a circle of initials in a colour
 * that belongs to the name.
 *
 * The app has no pictures to draw — nobody uploads anything, and there is
 * nowhere to keep one — so the circle wears initials, which is what a channel
 * falls back to as well: two letters for a person, and the letters of a model's
 * name for the model that answered. The colour is derived rather than chosen,
 * the way a row's wave is, so the same person wears the same circle everywhere
 * and nothing has to remember it.
 */

/** FNV-1a, the hash the waves use: a name always maps to the same colour. */
function seed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** The circles' colours: a wide spread, each dark enough for white letters. */
const TINTS = ["#b4552a", "#3f63c9", "#2f8f5b", "#8a5cd6", "#a8813a", "#2f7f95"];

/**
 * The letters a circle wears: the first letter of the name's first word and of
 * its last, so "Lisa Zhang" is `LZ` and "gemini-3.8-flash" is `GF`. A name with
 * nothing letterlike in it — a thread whose model was never named — wears a
 * question mark rather than an empty circle.
 */
function initials(who: string): string {
  const words = who.split(/[^\p{L}\p{N}]+/u).filter((word) => /\p{L}/u.test(word));
  if (words.length === 0) return "?";
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words[words.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

interface Props {
  /** Whose face it is: a person's name, or the id of the model that answered. */
  who: string;
  /** The circle's width, which is its height. */
  size?: number;
  /** What the circle is announced as, where nothing beside it says whose it is
   *  — a name drawn next to it is announcement enough, and it is hidden then. */
  label?: string;
}

export function Avatar({ who, size = 36, label }: Props) {
  const name = who.trim() === "" ? "?" : who.trim();
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        backgroundColor: TINTS[seed(name) % TINTS.length],
        fontSize: Math.max(9, Math.round(size * 0.4)),
      }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {initials(name)}
    </span>
  );
}
