import { useSyncExternalStore } from "react";

/**
 * What the window wears: the light scheme, the dark one, or the OS's own answer
 * to which of the two to wear.
 *
 * The choice is the window's rather than the settings file's. It has to apply the
 * moment it is made — a scheme that waited to be written to the file would be a
 * scheme nobody could see before the app had committed to it — while that file
 * holds the provider, the key and the models. It is kept in the webview's own
 * storage, which outlives the window it was chosen in.
 *
 * What the sheets read is not the choice but its resolution: `<html
 * data-theme="light">` or `<html data-theme="dark">`, painted here. `dark.css`
 * hangs its tokens off that attribute, so the CSS never has to know that
 * `system` exists — the question is answered where the OS can be asked, and
 * answered again whenever the desktop changes under the window.
 */
export type Theme = "light" | "dark" | "system";

/** Where the choice is kept. Namespaced: the window's storage is shared with
    whatever else this origin ever holds. */
const KEY = "chalk.theme";

/** The OS's answer to the question `system` is. */
const QUERY = "(prefers-color-scheme: dark)";

/** The desktop's own scheme, asked every time rather than remembered: the
    answer changes under the window, and the next question is what matters. */
function desktop(): "light" | "dark" {
  return window.matchMedia(QUERY).matches ? "dark" : "light";
}

/** What the window is set to. Anything unreadable — a first run, storage the
    platform has refused — follows the desktop, which is what it did before
    there was a choice. */
export function readTheme(): Theme {
  try {
    const kept = localStorage.getItem(KEY);
    if (kept === "light" || kept === "dark" || kept === "system") return kept;
  } catch {
    // Storage is denied; the desktop is still an answer to what to wear.
  }
  return "system";
}

/** The scheme the tokens are read in, resolved: the attribute every sheet goes
    by. Painting is all there is to wearing one — the tokens do the rest. */
function paint(theme: Theme) {
  document.documentElement.dataset.theme = theme === "system" ? desktop() : theme;
}

/** The readers of the choice: the control that shows it wants to redraw when it
    changes, and it is the same choice whichever window changed it. */
const listeners = new Set<() => void>();

function announce() {
  listeners.forEach((heard) => heard());
}

function subscribe(heard: () => void) {
  listeners.add(heard);
  return () => {
    listeners.delete(heard);
  };
}

/** Wears a scheme, keeps it for the next window, and says so. */
export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Something that can be worn but not kept; the session still gets it.
  }
  paint(theme);
  announce();
}

/**
 * Paints the scheme the window is set to, and follows the desktop while it is
 * following it: a scheme changed in System Settings lands on the window as it
 * changes, without anything being set again.
 *
 * Called from the entry, before the first render, so what is painted first is
 * painted in the right scheme — there is no frame of the other one. A window
 * reopened is told by another window's storage event, so a choice made beside it
 * reaches it too.
 */
export function installTheme() {
  paint(readTheme());

  window.matchMedia(QUERY).addEventListener("change", () => {
    if (readTheme() === "system") paint("system");
  });

  window.addEventListener("storage", (event) => {
    if (event.key !== KEY) return;
    paint(readTheme());
    announce();
  });
}

/** The choice, for the control that offers it. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, readTheme);
}
