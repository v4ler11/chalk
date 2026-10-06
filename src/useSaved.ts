import { useCallback, useEffect, useRef, useState } from "react";

/** How long the receipt for a save stays on screen, in milliseconds. */
const SAVED_MS = 2000;

/**
 * The receipt a save shows: a flag that is set the moment something is written
 * and taken away again a moment later, so a page can say "Saved" without
 * holding a timer of its own. It is a receipt for what just happened, not a
 * state the page is in, so an edit calls `clear` to take it away early: what it
 * says stops being true the moment anything is typed.
 */
export function useSaved(ms = SAVED_MS) {
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  /** Clears the timer that would have taken the receipt away. */
  const stop = useCallback(() => {
    if (savedTimer.current !== null) {
      window.clearTimeout(savedTimer.current);
      savedTimer.current = null;
    }
  }, []);

  /** Takes the receipt away now, rather than when its own timer would have. */
  const clear = useCallback(() => {
    stop();
    setSaved(false);
  }, [stop]);

  /** Shows the receipt for a moment, then takes it away again. */
  const flash = useCallback(() => {
    stop();
    setSaved(true);
    savedTimer.current = window.setTimeout(() => {
      savedTimer.current = null;
      setSaved(false);
    }, ms);
  }, [ms, stop]);

  // The timer is the page's, not the component tree's: it goes when the page
  // that set it unmounts, whatever else it was in the middle of.
  useEffect(() => stop, [stop]);

  return { saved, flash, clear };
}
