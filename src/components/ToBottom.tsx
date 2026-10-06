import { ArrowDown } from "lucide-react";

/**
 * The ↓ button, on the edge of a view that has been scrolled away from its own
 * end: it takes the reader back to the end. Both the transcript and the feed draw
 * it, at the same corner of the same kind of pane, so it is drawn once.
 */
export function ToBottom({ onClick }: { onClick: () => void }) {
  return (
    <button
      className="to-bottom"
      onClick={onClick}
      aria-label="Scroll to the latest"
      title="Scroll to the latest"
    >
      <ArrowDown size={16} />
    </button>
  );
}
