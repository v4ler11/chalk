import type { Partial } from "../types";
import { splitBlocks } from "../blocks";
import { sentAt } from "../clock";
import { useTicker } from "../timer";
import { ASSISTANT, ASSISTANT_NAME, ASSISTANT_TINT, Avatar } from "./Avatar";
import { Markdown } from "./Markdown";
import { Thinking } from "./Thinking";

interface Props {
  pending: Partial;
  /** Whether the answer arriving opens its turn's block, which it does when
   *  nothing of the model's is in the transcript yet. A turn that has already
   *  gone round wears its head on the round that opened it, and what arrives
   *  after that is drawn under it. */
  head: boolean;
}

/**
 * Live assistant bubble: the thinking line above the answer, as it arrives. The
 * bubble exists only while a response is in flight, so the ticker runs for its
 * whole lifetime.
 *
 * It is drawn in the shape the answer takes the moment it settles — the same
 * face, name and head over the same tree, and the same block when its turn
 * already has one — so a response finishing is a change of what is in the row and
 * not of the row itself. The head is timed from the first token, which is when
 * the answer began speaking: the same moment the committed answer's head is
 * marked with.
 *
 * The answer renders as markdown while it arrives, one block at a time: settled
 * blocks are memoized on their text, so each of them is parsed and rendered once
 * and only the block still growing is redone per token. Index keys survive
 * because the split only ever appends.
 *
 * The blocks go straight into the bubble rather than into a wrapper of their
 * own, so the live answer and the committed one are laid out from the same tree:
 * a wrapper would change which margins apply, and the message would settle by
 * a few pixels the moment the response finished.
 */
export function StreamingMessage({ pending, head }: Props) {
  const now = useTicker(true);
  const waitMs = pending.firstTokenAt == null ? now - pending.startedAt : pending.firstTokenAt - pending.startedAt;
  const thinkingMs = pending.thinkingMs ?? (pending.firstTokenAt == null ? 0 : now - pending.firstTokenAt);
  const { solid, tail } = splitBlocks(pending.answer);
  const parts = tail === "" ? solid : [...solid, tail];

  return (
    <div className={`msg assistant${head ? "" : " headless"}`}>
      {head && <Avatar who={ASSISTANT} size={36} colour={ASSISTANT_TINT} />}
      <div className="bubble">
        {head && (
          <div className="msg-head">
            <span className="msg-who">{ASSISTANT_NAME}</span>
            <span className="msg-when">{sentAt(pending.firstTokenAt ?? pending.startedAt)}</span>
          </div>
        )}
        <Thinking text={pending.reasoning} waitMs={waitMs} thinkingMs={thinkingMs} />
        {parts.map((text, i) => (
          <Markdown key={i} text={text} />
        ))}
        {parts.length === 0 && "…"}
      </div>
    </div>
  );
}
