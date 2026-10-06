import { Pin } from "lucide-react";
import { ChannelRowItem, type ChannelRow } from "./ChannelRow";

interface Props {
  /** The pinned threads, most recently pinned first, as the channel's own rows:
   *  the face, the mark, the prompt, the pictures and the line under it. */
  rows: ChannelRow[];
  /** What the app calls the person using it: a thread is what they posted, so the
   *  mark and the name a row wears are theirs. */
  author: string;
  onOpen: (chat: number) => void;
  onDelete: (chat: number) => void;
  onPin: (chat: number, pinned: boolean) => void;
}

/**
 * The threads that are pinned, drawn exactly as the channel draws them.
 *
 * A thread is what is pinned, and a thread is a row: so the list is the channel's
 * own rows with the unpinned ones left out, and it is drawn by the channel's own
 * component rather than by a second one. What a row says about a thread — its
 * face, its pin, its prompt, the pictures it carries, who has answered and when it
 * last was — is therefore the same here as there, and the pill at its corner is
 * the same pill: pinning is the one thing this list is about, so unpinning is
 * offered where the pin is read.
 */
export function PinsView({ rows, author, onOpen, onDelete, onPin }: Props) {
  if (rows.length === 0) {
    return (
      <div className="pins-empty">
        <Pin />
        <p className="json-note">
          Nothing is pinned yet. Hover a thread in the channel and pin it, and it will be here.
        </p>
      </div>
    );
  }

  return (
    <div className="channel-list">
      {rows.map((row) => (
        <ChannelRowItem
          key={row.chat}
          row={row}
          author={author}
          onOpen={onOpen}
          onDelete={onDelete}
          onPin={onPin}
        />
      ))}
    </div>
  );
}
