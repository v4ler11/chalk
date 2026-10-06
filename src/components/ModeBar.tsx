interface Props {
  /** What the taken-over pane is: named on the left of its bar. */
  title: string;
  /** Leaves the mode, from the red ESC on the right. */
  onClose: () => void;
}

/**
 * The bar a pane that has taken the window over draws at its top: what the pane
 * is on the left, and the way out on the right. The settings and the JSON view
 * both wear it — it is the strip that says which mode the window is in, and the
 * way out of a mode, besides the Escape key.
 *
 * The strip above it carries nothing in a mode: the way back into the feed
 * belongs to a thread's bar, and this bar is the way out of the pane a mode
 * stands in, so a bar with the arrow on it here would be a second answer to a
 * question this one has already answered.
 */
export function ModeBar({ title, onClose }: Props) {
  return (
    <div className="mode-bar" data-tauri-drag-region="deep">
      <span className="mode-title">{title}</span>
      <button className="json-esc" onClick={onClose}>
        ESC
      </button>
    </div>
  );
}
