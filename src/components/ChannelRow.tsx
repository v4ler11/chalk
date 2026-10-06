import { memo, useEffect, useState } from "react";
import type { RunStatus } from "../types";
import * as api from "../api";
import { ChatWave, waveSeed } from "./ChatWave";
import { RowDelete, useDeleteQuestion } from "./RowDelete";

/**
 * One thread as the channel lists it: the root message that opened it, and, under
 * it, one quiet line about where the thread stands. The row is a chat's own
 * summary plus what its run is doing, which is why the status lives here rather
 * than in the feed: every row has its own.
 */
export type ChannelRow = {
  /** The chat the row opens. */
  chat: number;
  /** The message that opened the thread, as it was typed. */
  root: string;
  /** Unix time in ms the thread was opened, which orders the feed. */
  createdAt: number;
  /** How many messages the thread holds after its opening one. */
  replies: number;
  /** How many pictures the prompt was posted with, which is what the row asks
   *  for them by: none is a row that has nothing to draw. */
  images: number;
  status: RunStatus;
  /** True while the run has not answered yet: it is thinking, not answering. */
  thinking: boolean;
  /** The calls the run is holding for the user. */
  awaiting: number;
  /** Whether this thread is the one on screen. */
  active: boolean;
};

/** The root message's first line, to name the thread in a control. */
function firstLine(text: string): string {
  const line = text.split("\n", 1)[0].trim();
  return line === "" ? "this thread" : line;
}

/**
 * The pictures a thread was opened with, kept once read.
 *
 * A row draws whenever anything about it moves, and an attachment is a data URL
 * of a megabyte or more, so what has been read is held rather than asked for
 * again. What the list says is how many there are; the pictures themselves come
 * from the transcript, when the row that shows them is drawn.
 */
const pictures = new Map<number, string[]>();

/** The pictures a row draws, read on the first draw that has a count to read. */
function usePictures(chat: number, count: number): string[] {
  const [images, setImages] = useState<string[]>(() => pictures.get(chat) ?? []);
  useEffect(() => {
    if (count === 0) return;
    const kept = pictures.get(chat);
    if (kept) {
      setImages(kept);
      return;
    }
    let live = true;
    void api
      .rootImages(chat)
      .then((urls) => {
        pictures.set(chat, urls);
        if (live) setImages(urls);
      })
      // A row that cannot draw its pictures draws none: the thread is still
      // there to open, and the row still says which thread it is.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [chat, count]);
  return images;
}

/**
 * What the row says about its run, in the app's own vocabulary: a thread nobody
 * has touched says nothing at all. The tone names the class that colours the
 * line: the wait is grey, a thread that needs the user is the app's blue, and a
 * failure is red. So the one place that knows what a status reads as is also the
 * one that says how it looks.
 */
function statusLine(row: ChannelRow): { text: string; tone: string } {
  if (row.status === "failed") return { text: "failed", tone: "failed" };
  if (row.status === "awaiting") return { text: "needs you", tone: "needs" };
  if (row.status === "running") {
    return row.thinking
      ? { text: "thinking…", tone: "thinking" }
      : { text: "answering…", tone: "answering" };
  }
  if (row.replies === 0) return { text: "", tone: "" };
  return { text: row.replies === 1 ? "1 reply" : `${row.replies} replies`, tone: "replies" };
}

interface Props {
  row: ChannelRow;
  onOpen: (chat: number) => void;
  onDelete: (chat: number) => void;
}

/**
 * One row of the feed: the wave that marks it as a conversation, the root message
 * that opens the thread on a click, the line about its run, and the button that
 * deletes it. The button holds its place whether or not it is drawn, so a row
 * never twitches under the pointer, and deleting asks first: the row becomes the
 * question, the same way a history row does.
 *
 * Memoized on the row's own fields: the window hands a fresh rows array, and
 * fresh row objects, on every run event, so the default shallow compare would
 * redraw the whole feed for one thread's status. A row draws nothing but those
 * fields, so a row whose fields are unchanged is left alone.
 */
export const ChannelRowItem = memo(
  function ChannelRowItem({ row, onOpen, onDelete }: Props) {
    const { asking, ask, giveUp } = useDeleteQuestion();
    const status = statusLine(row);
    const images = usePictures(row.chat, row.images);
    // A row being removed wears the open thread's treatment, so the question
    // reads as the row's own and not as a stray line in the feed.
    const lit = row.active || asking;

    return (
      <div className={`channel-row row${lit ? " active" : ""}${asking ? " confirming" : ""}`}>
        <ChatWave seed={waveSeed(String(row.chat))} strokeWidth={lit ? 1.5 : 1.25} />
        <div className="channel-body">
          {asking ? (
            // While the question is up the row keeps its wave and its place, and
            // what there is to read is the question rather than the message.
            <span className="channel-root">Delete this thread?</span>
          ) : (
            <button className="channel-open" onClick={() => onOpen(row.chat)}>
              <span className="channel-root">{row.root}</span>
            </button>
          )}
          {!asking && images.length > 0 && (
            <div className="channel-images">
              {images.map((url, i) => (
                <img key={i} className="channel-image" src={url} alt={`Attached image ${i + 1}`} />
              ))}
            </div>
          )}
          {status.text !== "" && !asking && (
            <div className={`channel-status ${status.tone}`}>{status.text}</div>
          )}
        </div>
        <RowDelete
          asking={asking}
          label={`Delete "${firstLine(row.root)}"`}
          ask={ask}
          giveUp={giveUp}
          onDelete={() => onDelete(row.chat)}
        />
      </div>
    );
  },
  (before, after) =>
    before.row.chat === after.row.chat &&
    before.row.root === after.row.root &&
    before.row.createdAt === after.row.createdAt &&
    before.row.replies === after.row.replies &&
    before.row.images === after.row.images &&
    before.row.status === after.row.status &&
    before.row.thinking === after.row.thinking &&
    before.row.awaiting === after.row.awaiting &&
    before.row.active === after.row.active,
);
