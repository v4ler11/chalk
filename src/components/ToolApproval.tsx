import { Play, X } from "lucide-react";
import type { ToolCallRequest } from "../types";
import { laidOut, toolLabel } from "../tools";

interface Props {
  /** The calls the model asked for, in the order it asked for them. */
  calls: ToolCallRequest[];
  onRun: () => void;
  onDecline: () => void;
}

/**
 * The tool calls a turn is waiting on.
 *
 * A server that is not marked to run its tools automatically has its calls
 * stopped here, between the transcript and the composer: the app can see what the
 * model wants to do, and the user is the one who decides whether it happens.
 * Both answers are given back to the model as the result of the call, so
 * whichever is chosen the conversation carries on rather than hanging on a
 * question nobody answered.
 */
export function ToolApproval({ calls, onRun, onDecline }: Props) {
  return (
    <div className="tool-approval" role="group" aria-label="Tools the model asked to run">
      <div className="tool-approval-head">
        <span className="tool-approval-question">
          {calls.length === 1 ? "Run this tool?" : `Run these ${calls.length} tools?`}
        </span>
        <div className="tool-approval-actions">
          <button className="tool-approval-run" onClick={onRun}>
            <Play />
            Run
          </button>
          <button className="tool-approval-decline" onClick={onDecline}>
            <X />
            Decline
          </button>
        </div>
      </div>
      <ul className="tool-approval-list">
        {calls.map((call, i) => (
          <li key={i}>
            {/* The name is the app's own — the server and the tool, joined — so
                it is shown in the two halves it was made of; the name a request
                carries is kept on the element itself. */}
            <span className="tool-approval-name" title={call.name}>
              {toolLabel(call.name)}
            </span>
            <code className="tool-approval-args">{laidOut(call.arguments)}</code>
          </li>
        ))}
      </ul>
    </div>
  );
}
