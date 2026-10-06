import { memo, useEffect, useState } from "react";
import { Pin, PinOff, Trash2 } from "lucide-react";
import * as api from "../api";
import { lastReply } from "../clock";
import { ASSISTANT, ASSISTANT_TINT, Avatar } from "./Avatar";
import { ImageStrip } from "./ImageStrip";
import { MessageHead } from "./MessageHead";
import { useDeleteQuestion } from "./RowDelete";
import type { ChannelRow } from "../feed";
// The row's own sheet, imported here rather than by the feed that draws it: two
// panes draw these rows now — the channel and the pins list — and a row that
// looked like itself in one of them and like something else in the other would be
// two drawings of one idea.
import "../styles/channel.css";

export type { ChannelRow };

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
  /** What the channel calls the person whose prompt this is. */
  author: string;
  onOpen: (chat: number) => void;
  onDelete: (chat: number) => void;
  /** Pins the thread this row is, or takes the pin off it. */
  onPin: (chat: number, pinned: boolean) => void;
}

/**
 * One row of the feed, drawn the way a channel draws a message: the face of
 * whoever posted it, their name and when they posted it, what they said, and —
 * under it — who answered and when. The root message opens the thread on a
 * click; the row offers its own two things while the pointer is in it, at its
 * top-right corner: pinning the thread, and deleting it.
 *
 * Deleting asks first, and the question is asked twice over on purpose: the bin
 * becomes Delete and Cancel in the menu, and the row says the same thing in its
 * own words where the message is — so the row that is about to go is the one
 * asking, and a pointer that wanders off it leaves a question still legible.
 *
 * Memoized on the row's own fields: the window hands a fresh rows array, and
 * fresh row objects, on every run event, so the default shallow compare would
 * redraw the whole feed for one thread's status. A row draws nothing but those
 * fields, so a row whose fields are unchanged is left alone.
 */
export const ChannelRowItem = memo(
  function ChannelRowItem({ row, author, onOpen, onDelete, onPin }: Props) {
    const { asking, ask, giveUp } = useDeleteQuestion();
    const status = statusLine(row);
    const images = usePictures(row.chat, row.images);
    const pinned = row.pinnedAt > 0;
    // When the row's line is the reply count and not a run's state, the row is a
    // thread summary: what belongs under it is who answered and when. A row that
    // is thinking, waiting on the user or failed is saying something else, and
    // neither is said beside that.
    const answered = status.tone === "replies";
    const now = Date.now();
    // A row being removed wears the open thread's treatment, so the question
    // reads as the row's own and not as a stray line in the feed.
    const lit = row.active || asking;

    return (
      <div
        className={`channel-row row${lit ? " active" : ""}${asking ? " confirming" : ""}${
          pinned ? " pinned" : ""
        }`}
      >
        <Avatar who={author} size={36} />
        <div className="channel-body">
          {/* Who wrote it, and when, above it — the line a channel starts a
              message with. A pin puts its mark on that line rather than on one of
              its own: a row's height is settled when it is written, and a pin
              added later must not move what is under it. */}
          <MessageHead
            who={author}
            when={row.createdAt}
            now={now}
            mark={
              pinned ? (
                <Pin
                  className="pin-mark"
                  role="img"
                  aria-label={author === "You" ? "Pinned by you" : `Pinned by ${author}`}
                />
              ) : undefined
            }
          />
          {asking ? (
            // While the question is up the row keeps its face and its place, and
            // what there is to read is the question rather than the message.
            <span className="channel-root">Delete this thread?</span>
          ) : (
            <button className="channel-open" onClick={() => onOpen(row.chat)}>
              <span className="channel-root">{row.root}</span>
            </button>
          )}
          {!asking && images.length > 0 && (
            <ImageStrip images={images} wrapClass="channel-images" imageClass="channel-image" />
          )}
          {/* And under it the line about the thread: who answered, the count of
              what was said, and the moment it last was. It is drawn whether or
              not it has anything to say — it holds its height, so a first answer
              landing does not grow the row under the reader. */}
          {!asking && (
            <div className={`channel-status ${status.tone}`}>
              {answered && (
                <span className="channel-participants">
                  {/* The prompt that opened the thread is the thread, not a reply
                      to it, so posting it does not make the person a participant
                      — answering it does. */}
                  {row.mine > 0 && <Avatar who={author} size={18} label={author} />}
                  <Avatar
                    who={ASSISTANT}
                    colour={ASSISTANT_TINT}
                    size={18}
                    label={row.model === "" ? "Answered" : `Answered by ${row.model}`}
                  />
                </span>
              )}
              {status.text !== "" && <span>{status.text}</span>}
              {answered && <span className="channel-last">{lastReply(row.updatedAt, now)}</span>}
            </div>
          )}
        </div>
        {/* What the row offers while the pointer is in it, at its own top-right
            corner: pin the thread, or delete it. It is out of the flow, since
            that corner is empty, so the row is the same height whether or not it
            is drawn — and it is drawn for as long as the question is up, so the
            answer is there to give even once the pointer has moved. */}
        <div className="row-menu">
          {asking ? (
            <>
              <button className="row-menu-word danger" onClick={() => onDelete(row.chat)}>
                Delete
              </button>
              <button className="row-menu-word" onClick={giveUp}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                className={`row-menu-action${pinned ? " on" : ""}`}
                title={pinned ? `Unpin "${firstLine(row.root)}"` : `Pin "${firstLine(row.root)}"`}
                aria-label={pinned ? "Unpin thread" : "Pin thread"}
                onClick={() => onPin(row.chat, !pinned)}
              >
                {pinned ? <PinOff /> : <Pin />}
              </button>
              <button
                className="row-menu-action"
                title={`Delete "${firstLine(row.root)}"`}
                aria-label="Delete thread"
                onClick={ask}
              >
                <Trash2 />
              </button>
            </>
          )}
        </div>
      </div>
    );
  },
  (before, after) =>
    before.row.chat === after.row.chat &&
    before.row.root === after.row.root &&
    before.row.createdAt === after.row.createdAt &&
    before.row.replies === after.row.replies &&
    before.row.mine === after.row.mine &&
    before.row.images === after.row.images &&
    before.row.model === after.row.model &&
    before.row.pinnedAt === after.row.pinnedAt &&
    before.row.updatedAt === after.row.updatedAt &&
    before.row.status === after.row.status &&
    before.row.thinking === after.row.thinking &&
    before.row.awaiting === after.row.awaiting &&
    before.row.active === after.row.active &&
    before.author === after.author,
);
