/**
 * FNV-1a over a name, for the two things the app derives from one rather than
 * storing: the colour of a face, and the shape of a conversation's wave. A name
 * always maps to the same number, so the same person wears the same circle
 * everywhere, and a row keeps its shape across renders.
 */
export function hashName(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
