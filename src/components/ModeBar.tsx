interface Props {
  /** What the taken-over pane is: named on the left of its bar. */
  title: string;
  /** Leaves the mode, from the red ESC on the right. */
  onClose: () => void;
}

/**
 * The bar a taken-over pane draws under the chat panel's own nav: what the pane
 * is on the left, and the way out on the right. The settings and the JSON view
 * both wear it — it is the strip that says which mode the window is in, and the
 * only way out of it besides the Escape key.
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
