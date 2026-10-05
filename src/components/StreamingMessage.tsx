import type { Partial } from "../types";
import { splitBlocks } from "../blocks";
import { useTicker } from "../timer";
import { Markdown } from "./Markdown";
import { Thinking } from "./Thinking";

interface Props {
  pending: Partial;
}

/**
 * Live assistant bubble: the thinking line above the answer, as it arrives. The
 * bubble exists only while a response is in flight, so the ticker runs for its
 * whole lifetime.
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
export function StreamingMessage({ pending }: Props) {
  const now = useTicker(true);
  const waitMs = pending.firstTokenAt == null ? now - pending.startedAt : pending.firstTokenAt - pending.startedAt;
  const thinkingMs = pending.thinkingMs ?? (pending.firstTokenAt == null ? 0 : now - pending.firstTokenAt);
  const { solid, tail } = splitBlocks(pending.answer);
  const parts = tail === "" ? solid : [...solid, tail];

  return (
    <div className="msg assistant">
      <div className="bubble">
        <Thinking text={pending.reasoning} waitMs={waitMs} thinkingMs={thinkingMs} />
        {parts.map((text, i) => (
          <Markdown key={i} text={text} />
        ))}
        {parts.length === 0 && "…"}
      </div>
    </div>
  );
}
