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
 * The colour the assistant's mark wears.
 *
 * Deliberately not one of the tints above. Those belong to whoever is writing,
 * and are derived from their name — so any of them can land on a person's
 * circle, and the assistant's must be the one colour a person cannot be given.
 * It is a slate: quiet enough to sit beside a name, and plainly not the app's
 * blue, which means a thread needs the reader.
 */
export const ASSISTANT_TINT = "#4d5566";

/**
 * The mark the assistant wears wherever it answers.
 *
 * It is the app's own rather than the model's: a thread is answered by whichever
 * model it happens to be holding, and the circle is the assistant in every
 * thread — so it is one mark and one colour, fixed, and not a monogram that
 * changes with the model. What answered is named in the circle's own label, and
 * the model is on the chip in the composer, which is where a model is chosen.
 */
export const ASSISTANT = "A";

/**
 * What the assistant is called above what it says, where a name sits over a
 * message rather than in a label. It is the app's own assistant rather than the
 * model that answered: a model's name written here would be the chat's current
 * one rather than the one that answered, which is a claim the transcript cannot
 * stand behind. What answered is named on the chip in the composer, which is
 * where a model is chosen.
 */
export const ASSISTANT_NAME = "Assistant";

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
  /** The colour to wear, where it is not to be derived from the name — the
   *  assistant's mark is not a person and wears a colour no person is given. */
  colour?: string;
  /** What the circle is announced as, where nothing beside it says whose it is
   *  — a name drawn next to it is announcement enough, and it is hidden then. */
  label?: string;
}

export function Avatar({ who, size = 36, colour, label }: Props) {
  const name = who.trim() === "" ? "?" : who.trim();
  return (
    <span
      className="avatar"
      style={{
        width: size,
        height: size,
        backgroundColor: colour ?? TINTS[seed(name) % TINTS.length],
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
