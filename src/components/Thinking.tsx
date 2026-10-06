import { ChevronRight } from "lucide-react";
import { formatDuration } from "../timer";

interface Props {
  /** Reasoning text, as it arrived. */
  text: string;
  /** How long the model took to produce its first token. */
  waitMs: number;
  /** How long it has been thinking; counts up while it still is. */
  thinkingMs: number;
}

/**
 * The thinking box: how long the first token took on one line, and under it the
 * time spent reasoning with a chevron to open it, then the reasoning itself.
 *
 * It is a plain `<details>`, closed by default and left to the browser to open
 * and close. Nothing remembers the reader's preference, so a block never opens
 * or shuts under their hands, and it always grows downward from its own line —
 * which is also the line the pointer is on, so the two never move apart.
 *
 * A model that reasoned nothing gets the wait alone: no reading of a zero, and
 * no chevron onto an empty box — the reasoning itself is the only thing that
 * says there was any.
 */
export function Thinking({ text, waitMs, thinkingMs }: Props) {
  // The wait is on both drawings of the box: a model that reasoned nothing is
  // shown the wait alone, and one that did is shown it above the reasoning.
  const waiting = <span className="timer">Waiting {formatDuration(waitMs)}</span>;

  if (text === "") {
    return <div className="thinking">{waiting}</div>;
  }

  return (
    <details className="thinking">
      <summary>
        {waiting}
        <span className="thinking-line">
          <span className="timer">Thinking {formatDuration(thinkingMs)}</span>
          <ChevronRight className="chevron" />
        </span>
      </summary>
      <div className="thinking-body">{text}</div>
    </details>
  );
}
