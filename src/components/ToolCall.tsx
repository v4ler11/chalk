import { useState } from "react";
import { ChevronRight, Plug } from "lucide-react";
import { formatBrief } from "../timer";
import { laidOut, toolParts } from "../tools";

interface Props {
  /** The name the call carries: the server's id and the tool's own name, joined. */
  name: string;
  /** The arguments, as the JSON text the model sent: the card's own, since the
   *  row is the call and not what it carried. */
  args?: string;
  /**
   * What the tool answered, once it has: the text the model was given, and how
   * long the server took over it. Absent while the call is still waiting — on
   * the approval card, or on a chat read back mid-turn.
   */
  result?: { text: string; ms?: number };
}

/**
 * One tool call, as the transcript shows it: a row — what the server took, and
 * what was called — and, under it, the card the row opens into.
 *
 * The row is a record of an identifier being invoked, so it is set as code:
 * monospace, one line, cut off rather than wrapped. What the call carried is the
 * card's rather than the row's — a line of arguments in the row is a line cut
 * off before the part worth reading, and a row of `{}` is a row reading
 * punctuation — so the card is the rest of the same fact: the arguments laid
 * out, and what came back. It stays shut until it is asked for, since a tool's
 * result is usually long and rarely read twice.
 *
 * A call the app answers itself — the loader, and the tools that manage the
 * models and the servers — has no server on it, so it is shown as the tool it
 * is, with no separator and no chip standing for a server that never took part.
 */
export function ToolCall({ name, args, result }: Props) {
  const [open, setOpen] = useState(false);
  const { server, tool } = toolParts(name);
  // The row shows none of this. The card shows what there was: a call that
  // carried `{}` carried an empty object, which is a fact about it and not the
  // same as a call that carried nothing at all.
  const arguments_ = args !== undefined && args !== "" ? args : undefined;

  return (
    <div className={`tool-call${open ? " open" : ""}`}>
      {/* The row is the whole line, so a click anywhere on it opens the card:
          it is where the arguments are. */}
      <button
        className="tool-call-row"
        aria-expanded={open}
        aria-label={`${server ? `${server} ` : ""}${tool} — ${open ? "hide" : "show"} the call`}
        onClick={() => setOpen((shown) => !shown)}
      >
        {/* The timer holds its place whether or not there is one: a call still
            running has no time yet, and the names below it still have to line
            up with the ones that do. */}
        <span className="timer tool-call-timer">
          {result?.ms != null ? formatBrief(result.ms) : ""}
        </span>
        <span className="tool-call-id">
          {server !== "" && (
            <>
              <span className="tool-call-server">{server}</span>
              <span className="tool-call-sep">·</span>
            </>
          )}
          <span className="tool-call-tool">{tool}</span>
        </span>
        <ChevronRight className="tool-call-chevron" />
      </button>
      {open && (
        <div className="tool-call-card">
          <div className="tool-call-head">
            {/* The server's own chip, then the tool as the server names it: the
                two halves of the name a request carries. A call the app answers
                itself carries no server, so there is nothing to chip and the
                head is the tool. */}
            {server !== "" && (
              <span className="tool-call-chip">
                <Plug />
                {server}
              </span>
            )}
            <span className="tool-call-tool">{tool}</span>
          </div>
          {arguments_ !== undefined && (
            <div className="tool-call-section">
              <span className="tool-call-section-name">Arguments</span>
              <pre className="tool-call-json">{laidOut(arguments_)}</pre>
            </div>
          )}
          {result !== undefined && (
            <div className="tool-call-section">
              <span className="tool-call-section-name">Result</span>
              <pre className="tool-call-json">{laidOut(result.text)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
