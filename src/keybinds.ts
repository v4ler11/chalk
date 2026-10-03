/**
 * The window's shortcuts. There is no menu bar to carry them, so the commands
 * the chrome offers are bound in the webview — and every hint that names one
 * takes its label from here, so a hint cannot drift from its binding.
 */
const isMac = navigator.userAgent.includes("Mac");

/** The modifier the shortcuts are built on: Command on a Mac, Control elsewhere. */
export const MOD = isMac ? "⌘" : "Ctrl";

/**
 * Whether an event carries that modifier, and no other. Typed by the properties
 * it reads, so the window's own listeners and React's handlers — whose event
 * types differ — can both ask.
 */
export function mod(event: {
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey;
}
