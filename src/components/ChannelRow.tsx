import { memo, useEffect, useState } from "react";
import type { RunStatus } from "../types";
import * as api from "../api";
import { lastReply, sentAt } from "../clock";
import { ASSISTANT_TINT, Avatar } from "./Avatar";
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
  /** How many of those the user wrote, the prompt that opened the thread not
   *  among them: it is what says whether they are a participant in it. */
  mine: number;
  /** How many pictures the prompt was posted with, which is what the row asks
   *  for them by: none is a row that has nothing to draw. */
  images: number;
  /** The model this thread is with: who answered it, as its circle is drawn. */
  model: string;
  /** Unix time in ms of the thread's last message, which is when it was last
   *  answered — what the row says under the count of what was said. */
  updatedAt: number;
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

/**
 * The mark the assistant wears wherever it answers.
 *
 * It is the app's own rather than the model's: a thread is answered by whichever
 * model it happens to be holding, and the circle is the assistant in every
 * thread — so it is one mark and one colour, fixed, and not a monogram that
 * changes with the model. What answered is named in the circle's own label, and
 * the model is on the chip in the composer, which is where a model is chosen.
 */
const ASSISTANT = "A";

interface Props {
  row: ChannelRow;
  /** What the channel calls the person whose prompt this is. */
  author: string;
  onOpen: (chat: number) => void;
  onDelete: (chat: number) => void;
}

/**
 * One row of the feed, drawn the way a channel draws a message: the face of
 * whoever posted it, their name and when they posted it, what they said, and —
 * under it — who answered and when. The root message opens the thread on a
 * click; the button that deletes it holds its place whether or not it is drawn,
 * so a row never twitches under the pointer, and deleting asks first: the row
 * becomes the question, the same way a history row does.
 *
 * Memoized on the row's own fields: the window hands a fresh rows array, and
 * fresh row objects, on every run event, so the default shallow compare would
 * redraw the whole feed for one thread's status. A row draws nothing but those
 * fields, so a row whose fields are unchanged is left alone.
 */
export const ChannelRowItem = memo(
  function ChannelRowItem({ row, author, onOpen, onDelete }: Props) {
    const { asking, ask, giveUp } = useDeleteQuestion();
    const status = statusLine(row);
    const images = usePictures(row.chat, row.images);
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
      <div className={`channel-row row${lit ? " active" : ""}${asking ? " confirming" : ""}`}>
        <Avatar who={author} size={36} />
        <div className="channel-body">
          {/* Who wrote it, and when, above it — the line a channel starts a
              message with. */}
          <div className="channel-head">
            <span className="channel-who">{author}</span>
            <span className="channel-when">{sentAt(row.createdAt, now)}</span>
          </div>
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
            <div className="channel-images">
              {images.map((url, i) => (
                <img key={i} className="channel-image" src={url} alt={`Attached image ${i + 1}`} />
              ))}
            </div>
          )}
          {/* And under it, everyone who has said something in the thread and
              when it was last answered: the person, once they have spoken here,
              the assistant that answered, the count of what was said, and the
              moment it last was. */}
          {status.text !== "" && !asking && (
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
              <span>{status.text}</span>
              {answered && <span className="channel-last">{lastReply(row.updatedAt, now)}</span>}
            </div>
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
    before.row.mine === after.row.mine &&
    before.row.images === after.row.images &&
    before.row.model === after.row.model &&
    before.row.updatedAt === after.row.updatedAt &&
    before.row.status === after.row.status &&
    before.row.thinking === after.row.thinking &&
    before.row.awaiting === after.row.awaiting &&
    before.row.active === after.row.active &&
    before.author === after.author,
);
