import { useCallback, useEffect, useRef, useState } from "react";
import { copyText } from "./clipboard";

/** How long the receipt stands after a copy, in ms. */
const RECEIPT_MS = 1200;

/**
 * Copying something, and saying so: the app's one receipt. `copied` is true for
 * as long as it stands, which is what a control swaps its icon or its label for.
 *
 * The timer is held rather than left to run on its own, so copying again
 * restarts the receipt instead of leaving the first one to clear it early. A
 * copy that did not land reports nothing: the receipt is the only thing said
 * here, and saying it over an empty clipboard would be a lie.
 */
export function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false);
  const timer = useRef(0);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = useCallback((text: string) => {
    void copyText(text).then((landed) => {
      if (!landed) return;
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), RECEIPT_MS);
    });
  }, []);

  return { copied, copy };
}
