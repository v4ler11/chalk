//! Links belong to the system, not to the window.
//!
//! A transcript's links are written by the model, so they are neither the app's
//! own pages nor trusted: what a click on one means is "show me this", and the
//! answer is the system browser. Left alone, a click is an ordinary navigation,
//! and the window — which is the whole app — follows the link and is gone.
//!
//! One capture-phase listener on the document covers every anchor there is,
//! wherever it came from, rather than a renderer per markdown element. Modifier
//! clicks and the middle button ask for a second window; the app has none to
//! give, so they are handed over the same way. What is not handed over is
//! anything the app itself owns: a URL of the window's own origin stays a
//! navigation, and the schemes the system cannot act on are left alone rather
//! than swallowed.

import { openUrl } from "@tauri-apps/plugin-opener";

/**
 * The schemes the system is asked to open, which are the ones `opener:default`
 * allows: a page, a mailbox, a phone number. Anything else — `data:`,
 * `javascript:`, a file path — is not a link to follow.
 */
const EXTERNAL = new Set(["http:", "https:", "mailto:", "tel:"]);

/**
 * The URL to hand over, or `null` to leave the click alone.
 *
 * Relative hrefs resolve against the page they are on, so the two kinds are
 * told apart by origin rather than by how they were written: the dev server's
 * `http://localhost:1420/…` and a release build's `tauri://localhost/…` are both
 * the window's own.
 */
function external(href: string): string | null {
  let url: URL;
  try {
    url = new URL(href, window.location.href);
  } catch {
    return null;
  }
  if (url.origin === window.location.origin) return null;
  return EXTERNAL.has(url.protocol) ? url.href : null;
}

/**
 * Hands one URL to the system, and opens a tab where there is no system to ask
 * — the browser the dev harness runs in, which is the only place `openUrl` has
 * nothing behind it.
 */
function open(url: string) {
  void openUrl(url).catch(() => {
    window.open(url, "_blank", "noopener");
  });
}

/** Every anchor in the document, on every mouse that can follow one. */
export function installLinks() {
  const hand = (event: MouseEvent) => {
    if (event.defaultPrevented) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]");
    if (!anchor) return;
    const url = external(anchor.getAttribute("href") ?? "");
    if (!url) return;
    event.preventDefault();
    open(url);
  };
  document.addEventListener("click", hand, true);
  // The middle button is a click of its own kind, and the one browsers answer
  // with a tab behind the page.
  document.addEventListener("auxclick", (event) => {
    if (event.button === 1) hand(event);
  }, true);
}
