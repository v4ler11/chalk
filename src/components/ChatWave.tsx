/**
 * The conversation mark from the design: a short wave stroke in front of a chat
 * row. The design repeats one path for every row; here each row draws its own,
 * with humps of varying width and amplitude, so the history reads as a list of
 * different conversations rather than a column of the same stamp.
 *
 * The path is derived from a seed rather than stored, so a row keeps its shape
 * across renders. It strokes in `currentColor`, so it follows the colour set on
 * the row that holds it; the design draws the open conversation at 1.5 and the
 * older rows at 1.25.
 */

/** FNV-1a: a small, stable hash so a title always maps to the same wave. */
export function waveSeed(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const WIDTH = 15;
const MID = 6.5;

/** A wave across the icon's own box: `Q` humps alternating above and below the
 *  midline, which meet at matching tangents — so the stroke never corners. */
function wavePath(seed: number): string {
  let state = seed || 1;
  const rnd = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };

  let x = 0;
  let up = true;
  let d = `M0 ${MID}`;
  // Humps shorter than the design's 2.83-unit ones, so the wave carries more of
  // them, but not so short that a 1.25px stroke closes up into a texture.
  while (x < WIDTH - 1.2) {
    const end = Math.min(WIDTH, x + 2.4 + rnd() * 0.4);
    const amp = 2.6 + rnd() * 0.6;
    d += ` Q${((x + end) / 2).toFixed(2)} ${(MID + (up ? -amp : amp)).toFixed(2)} ${end.toFixed(2)} ${MID}`;
    x = end;
    up = !up;
  }
  return d;
}

interface Props {
  /** Chooses the wave; the same seed always draws the same shape. */
  seed: number;
  size?: number;
  strokeWidth?: number;
}

export function ChatWave({ seed, size = 15, strokeWidth = 1.5 }: Props) {
  return (
    <svg
      className="chat-wave"
      width={size}
      height={(size * 13) / 15}
      viewBox="0 0 15 13"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path vectorEffect="non-scaling-stroke" d={wavePath(seed)} />
    </svg>
  );
}
