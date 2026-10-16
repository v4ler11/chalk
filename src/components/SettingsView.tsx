import { useCallback, useEffect, useRef, useState } from "react";
import type { AppConfig } from "../types";
import * as api from "../api";
import { SettingsPanel, type TabId } from "./SettingsPanel";

interface Props {
  /** The config as the window last read it: the draft starts from it, and is
   *  taken up again whenever the file changes under the page. */
  config: AppConfig;
  /** Writes a config, and answers with what the file now holds. */
  save: (config: AppConfig) => Promise<AppConfig>;
  /** Takes up what was just written, so the window stops asking with the old one. */
  onSaved: (config: AppConfig) => void;
  /**
   * Where a write that fails is said when there is no page left to say it on:
   * the way out writes what the reader left behind, and the pane that would have
   * carried the notice is the one being taken down. Every other failure is said
   * in the page itself, which is still there to hold it.
   */
  onFailure?: (e: unknown) => void;
  /** Opens the log window, which the harness draws nothing for. */
  onOpenLogs?: () => void;
  /** The section a page opens on, where it is not the first. */
  initialTab?: TabId;
}

/**
 * How long the page waits after the last edit before it writes it, in
 * milliseconds: long enough that a reader who is typing is not written word by
 * word, short enough that a reader who has stopped does not wonder whether it
 * took.
 */
const IDLE_MS = 700;

/**
 * The file as it is now, with the reader's own changes laid over it.
 *
 * A field is the reader's when the draft holds a different value for it than
 * the file it started from; only those are taken, and every other field is left
 * as the file has it. The file has other writers — the app's own tools among
 * them — so a value the page never touched belongs to whoever last wrote it
 * rather than to the copy the page read before they did.
 */
function merge(base: AppConfig, basis: AppConfig, draft: AppConfig): AppConfig {
  const written = { ...base };
  for (const key of Object.keys(draft) as (keyof AppConfig)[]) {
    if (draft[key] === basis[key]) continue;
    Object.assign(written, { [key]: draft[key] });
  }
  return written;
}

/**
 * The settings, standing in the chat's place in the window itself: the sections
 * and the form.
 *
 * There is no Save. The page writes itself — a moment after the last edit, when
 * the reader has stopped, and at once when the window loses the focus or the
 * settings are left — because every field here is a fact about the file rather
 * than a form under review, and a reader who has said a thing has said it. What
 * is written is the file as it stands with the fields the reader changed laid
 * over it, rather than the draft as a whole: the file has other writers — the
 * app's own tools among them — and a draft sent whole would put back whatever
 * they wrote while the page held an edit of its own.
 *
 * The draft is held apart from the file it came from. A write that fails is said
 * out loud and stays pending — the draft is behind the file until it lands — so
 * the next edit, the next blur or the way out tries again.
 */
export function SettingsView({
  config,
  save,
  onSaved,
  onFailure,
  onOpenLogs = api.openLogs,
  initialTab,
}: Props) {
  // What the file is known to hold. The draft and the file are the same object
  // until an edit makes a new draft, which is what "behind" means here: no
  // timestamp and no flag to keep in step, only whether the page has moved.
  const [file, setFile] = useState(config);
  const [draft, setDraft] = useState(config);
  const [error, setError] = useState("");
  const behind = draft !== file;
  // Writes run one after another: two answers racing for one file would let the
  // older of them land last.
  const queue = useRef<Promise<void>>(Promise.resolve());
  // What the page holds, for a write that is not a render: the draft the reader
  // has, the file it started from, and the file as the window last read it. The
  // last of the three moves under the page while the reader is typing — the
  // app's own tools write the file too — and it is what a write lays the reader's
  // changes over, so that what they did not touch is left as it now stands.
  const held = useRef({ draft, file, latest: config });

  useEffect(() => {
    held.current = { draft, file, latest: config };
  }, [draft, file, config]);

  // A config that changes under the page — the answer to a write of its own, or
  // the file edited by hand and read again — is taken up while the page has
  // nothing of its own to keep.
  useEffect(() => {
    if (draft !== file) return;
    setFile(config);
    setDraft(config);
  }, [config, draft, file]);

  /** Writes the reader's changes over the file as it now stands, and takes the
      file's answer up unless the page has moved on. */
  const write = useCallback((pending: AppConfig) => {
    const { file: basis, latest: base } = held.current;
    const sent = merge(base, basis, pending);
    queue.current = queue.current.then(async () => {
      try {
        const written = await save(sent);
        setError("");
        setFile(written);
        onSaved(written);
        // The answer is the draft only while it is still the newest thing the
        // page holds; a newer draft is the next write's problem.
        setDraft((current) => (current === pending ? written : current));
      } catch (e) {
        setError(String(e));
      }
    });
  }, [save, onSaved]);

  // The reader having stopped is what the timer is: every edit starts it again.
  useEffect(() => {
    if (!behind) return;
    const timer = window.setTimeout(() => write(draft), IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [draft, behind, write]);

  // The focus leaving the window is the other half of the same thing: the reader
  // is not going to finish that word, so there is nothing to wait for. Leaving
  // the settings is the third, and it is the cleanup below.
  useEffect(() => {
    if (!behind) return;
    const onBlur = () => write(draft);
    window.addEventListener("blur", onBlur);
    return () => window.removeEventListener("blur", onBlur);
  }, [draft, behind, write]);

  useEffect(
    () => () => {
      // The way out, taken in the same breath: a reader who closed the settings
      // has stopped editing them just as surely as one who clicked away. It goes
      // through the queue like every other write, so a draft already on its way
      // to the file cannot be overtaken by this one.
      //
      // A failure here has no page left to hold a notice, so it is handed to the
      // window rather than dropped: the reader made an edit, the file did not
      // take it, and the one place that can still say so is the pane the settings
      // were left for.
      const { draft: last, file: basis, latest: base } = held.current;
      if (last === basis) return;
      queue.current = queue.current.then(() =>
        save(merge(base, basis, last)).then(onSaved).catch((e) => onFailure?.(e)),
      );
    },
    // A cleanup is not a render: it reads what it needs from `held`, and the
    // two callbacks are the parent's own, stable across the page's life.
    [save, onSaved, onFailure],
  );

  return (
    // The sections and the page are one row of the pane, so the row is the
    // view's own box rather than the pane's: a pane stacks what it is given, and
    // without this the list would sit above the page it opens.
    <div className="settings-body">
      <SettingsPanel
        config={draft}
        initialTab={initialTab}
        notice={error !== "" ? <p className="notice">Not written: {error}</p> : undefined}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        onOpenLogs={onOpenLogs}
      />
    </div>
  );
}
