import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, History, Wrench } from "lucide-react";
import * as api from "../api";
import { copyText } from "../clipboard";
import { groupTools } from "../lazy";
import { tokens, toolBytes } from "../tools";
import type { NavSection } from "./SectionNav";
import type { LazyServer, McpCost, McpTool, UiMessage } from "../types";

/** Which JSON the pane is showing: the conversation, or the tools it offers. */
export type JsonTab = "history" | "tools";

/** The JSON view's sections, in the order its sidebar lists them. */
export const JSON_SECTIONS: NavSection[] = [
  { id: "history", label: "History", icon: History },
  { id: "tools", label: "Tools", icon: Wrench },
];

interface Props {
  /** Which JSON to show: the conversation, or the tools. */
  tab: JsonTab;
  /** The open chat's transcript, as the window holds it. */
  messages: UiMessage[];
  /** The configured prompt sent ahead of every request, and never part of a
   *  transcript; shown in front of it, as a request carries it. */
  systemPrompt: string;
  /** The tools the request carries: `toolsFor`'s answer, the very list the chat
   *  command is handed. What is not here is not in the request. */
  tools: McpTool[];
  /** What each server's tools cost a request, as last read; the app's own group
   *  has none, and is measured from its tools instead. */
  costs: McpCost[];
  /** The lazily imported servers still waiting to be loaded, as the prompt will
   *  name them; the backend needs them to build the request's system message. */
  lazy: LazyServer[];
}

const TOKEN =
  /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}\[\],:]/g;

/**
 * The pretty-printed JSON as coloured spans: keys, strings, numbers and the
 * three literals each take a class, and everything between them — the
 * whitespace, the braces, the commas — is left as it is, so the text still
 * reads as JSON and copies as JSON.
 *
 * A string is a key when the next thing after it is the colon that binds it,
 * which is the only place the two are told apart.
 */
function highlight(source: string): ReactNode[] {
  const out: ReactNode[] = [];
  let end = 0;
  let key = 0;
  for (const match of source.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > end) out.push(source.slice(end, at));
    const token = match[0];
    let cls: string | null = null;
    if (token[0] === '"') {
      let i = at + token.length;
      while (source[i] === " ") i++;
      cls = source[i] === ":" ? "json-key" : "json-string";
    } else if (token === "true" || token === "false" || token === "null") {
      cls = "json-literal";
    } else if (/^-?\d/.test(token)) {
      cls = "json-number";
    }
    out.push(cls ? <span key={key++} className={cls}>{token}</span> : token);
    end = at + token.length;
  }
  if (end < source.length) out.push(source.slice(end));
  return out;
}

/**
 * The conversation, or the tools, as plain JSON in the transcript's place while
 * the view is on.
 *
 * History is the request's own messages, and Tools is the request's own tool
 * list, grouped by the server that offers them and collapsible — so what is on
 * screen is what the model is given, and nothing else. A lazily imported server
 * that has not been loaded is therefore absent from Tools; it is named in the
 * History tab's system message instead. The Copy button holds the pane's
 * bottom-right corner whatever the JSON is doing.
 */
export function JsonView({
  tab,
  messages,
  systemPrompt,
  tools,
  costs,
  lazy,
}: Props) {
  const [copied, setCopied] = useState(false);
  // The request's own messages, as the backend assembles them — the configured
  // prompt resolved and the lazily imported servers named under it. `null` until
  // it answers, and left `null` where there is no backend to ask (the harness),
  // so the fallback below is what a browser shows.
  const [preview, setPreview] = useState<UiMessage[] | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .requestPreview(messages, lazy)
      .then((asked) => {
        if (alive) setPreview(asked);
      })
      .catch(() => {
        if (alive) setPreview(null);
      });
    return () => {
      alive = false;
    };
  }, [messages, lazy]);

  const groups = useMemo(() => groupTools(tools), [tools]);

  // What the model is sent, and, only when the backend cannot be asked, the
  // window's own reading of it — the prompt as written, with no addendum.
  const conversation = useMemo<unknown[]>(() => {
    if (preview !== null) return preview;
    const said = systemPrompt.trim();
    return said === "" ? messages : [{ role: "system", content: said }, ...messages];
  }, [preview, messages, systemPrompt]);

  const payload = useMemo(
    () => (tab === "tools" ? groups.flatMap((group) => group.tools) : conversation),
    [tab, groups, conversation],
  );
  const text = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  // What each group's own JSON is. The conversation is highlighted only when it
  // is what is showing, since a large pool of schemas is not cheap to colour.
  const bodies = useMemo(
    () =>
      groups.map((group) => {
        const bytes = costs.find((cost) => cost.server === group.id)?.bytes ?? toolBytes(group.tools);
        const count = group.tools.length;
        return {
          group,
          meta: `${count === 1 ? "1 tool" : `${count} tools`} ~${tokens(bytes)} Tok`,
          body: highlight(JSON.stringify(group.tools, null, 2)),
        };
      }),
    [groups, costs],
  );
  const body = useMemo(() => (tab === "history" ? highlight(text) : null), [tab, text]);

  async function copy() {
    if (!(await copyText(text))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="json-pane">
      <div className="json-view">
        {tab === "tools" ? (
          <div className="tool-groups">
            {bodies.map(({ group, meta, body: groupBody }) => (
              <details className="tool-group" key={group.id || "__chalk"}>
                <summary className="tool-group-head">
                  <ChevronDown className="tool-group-chevron" />
                  <span className="tool-group-name">{group.name}</span>
                  <span className="tool-group-meta">{meta}</span>
                </summary>
                <pre className="json-pre">{groupBody}</pre>
              </details>
            ))}
            {bodies.length === 0 && <p className="json-note">This request carries no tools.</p>}
          </div>
        ) : (
          <pre className="json-pre">{body}</pre>
        )}
      </div>
      <button className="json-copy" onClick={copy} aria-label="Copy JSON">
        {copied ? <Check className="icon" /> : <Copy className="icon" />}
        <span>{copied ? "Copied" : "Copy"}</span>
      </button>
    </div>
  );
}
