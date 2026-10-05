import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown, Copy, History, Wrench } from "lucide-react";
import * as api from "../api";
import { copyText } from "../clipboard";
import { groupTools } from "../lazy";
import { tokens, toolBytes } from "../tools";
import type { NavSection } from "./SectionNav";
import type { McpCost, RequestPreview } from "../types";

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
  /** The thread whose request is shown. The backend assembles it — the system
   *  prompt resolved, the headers written, the lazy addendum named — so the
   *  window reads the request rather than rendering its own idea of one. */
  chat: number;
  /** What each server's tools cost a request, as last read; the app's own group
   *  has none, and is measured from its tools instead. */
  costs: McpCost[];
}

const TOKEN =
  /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}\[\],:]/g;

/** Nothing open, for a text whose markers have not been touched. */
const EMPTY: ReadonlySet<number> = new Set();

/** What the pane shows while there is no request to show, held by identity so a
 *  render that has not heard back yet does not rebuild the JSON. */
const NO_MESSAGES: RequestPreview["messages"] = [];
const NO_TOOLS: RequestPreview["tools"] = [];

/**
 * How much of one value is shown before the rest of it is only counted, and the
 * marker that counts it is the way to see it.
 *
 * A transcript carries what was sent and what came back, and one of those can be
 * a page of base64 — a screenshot's data URL, a file read whole. The pane is for
 * reading the shape of a request, so a value past this length is laid out by its
 * beginning alone: the JSON appears at once instead of pushing megabytes of
 * glyphs through the layout, which is the whole of the cost of this view. What
 * is left out is not gone — the marker under it opens the value in place, and
 * **Copy** takes the request whole either way, since what it copies is the text
 * and not what was made of it.
 */
const SHOWN = 200;

/** What is left of a value, as the marker counts it: `18 KB`, `2.2 MB`. */
function size(characters: number): string {
  const kb = characters / 1024;
  return kb < 1000 ? `${Math.round(kb)} KB` : `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * The pretty-printed JSON as coloured spans: keys, strings, numbers and the
 * three literals each take a class, and everything between them — the
 * whitespace, the braces, the commas — is left as it is, so the text still
 * reads as JSON and copies as JSON.
 *
 * A string is a key when the next thing after it is the colon that binds it,
 * which is the only place the two are told apart. One longer than [`SHOWN`] is
 * shown by its beginning with a marker under it, and the marker is a button that
 * opens the rest of the value in place and closes it again. The value's own
 * index is what `open` holds and `expand` turns over, so what is opened is
 * opened for the text it belongs to rather than for the position it happened to
 * land in.
 */
function highlight(
  source: string,
  open: ReadonlySet<number>,
  expand: (index: number) => void,
): ReactNode[] {
  const nodes: ReactNode[] = [];
  let end = 0;
  let key = 0;
  for (const match of source.matchAll(TOKEN)) {
    const at = match.index ?? 0;
    if (at > end) nodes.push(source.slice(end, at));
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
    if (cls === "json-string" && token.length > SHOWN) {
      const index = key++;
      const head = token.slice(0, SHOWN);
      const rest = token.slice(SHOWN);
      nodes.push(
        <span key={index} className="json-string">
          {head}
        </span>,
      );
      if (open.has(index)) {
        nodes.push(
          <span key={key++} className="json-string">
            {rest}
          </span>,
          <button
            key={key++}
            type="button"
            className="json-more"
            title="Hide this value again"
            aria-expanded
            onClick={() => expand(index)}
          >
            … show less
          </button>,
        );
      } else {
        nodes.push(
          <button
            key={key++}
            type="button"
            className="json-more"
            title="Show this value in full"
            aria-expanded={false}
            onClick={() => expand(index)}
          >
            … {size(rest.length)} more
          </button>,
        );
      }
    } else {
      nodes.push(cls ? <span key={key++} className={cls}>{token}</span> : token);
    }
    end = at + token.length;
  }
  if (end < source.length) nodes.push(source.slice(end));
  return nodes;
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
export function JsonView({ tab, chat, costs }: Props) {
  const [copied, setCopied] = useState(false);
  // The request as the backend assembles it: the prompt resolved, the prompts
  // headed with the time they were sent, the lazy addendum named, and the tools
  // the round would offer. `null` until it answers, and left `null` where there
  // is no backend to ask (the harness), so the pane shows nothing rather than
  // the window's own idea of a request.
  const [preview, setPreview] = useState<RequestPreview | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .requestPreview(chat)
      .then((asked) => {
        if (alive) setPreview(asked);
      })
      .catch(() => {
        if (alive) setPreview(null);
      });
    return () => {
      alive = false;
    };
  }, [chat]);

  const messages = preview?.messages ?? NO_MESSAGES;
  const tools = preview?.tools ?? NO_TOOLS;
  const groups = useMemo(() => groupTools(tools), [tools]);

  // What the model is sent, whole: the backend's own assembly, read as it is.
  const conversation = messages;

  const payload = useMemo(
    () => (tab === "tools" ? groups.flatMap((group) => group.tools) : conversation),
    [tab, groups, conversation],
  );
  const text = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

  // Which abbreviated values are open, held against the text they belong to: the
  // markers are positions in one request's JSON and mean nothing in the next. A
  // second press closes what the first opened, which is the only way back from a
  // value big enough to be worth a control of its own.
  const [expanded, setExpanded] = useState<{ text: string; open: ReadonlySet<number> }>({
    text: "",
    open: EMPTY,
  });
  const open = expanded.text === text ? expanded.open : EMPTY;
  const expand = useCallback(
    (index: number) =>
      setExpanded((previous) => {
        const shown = new Set(previous.text === text ? previous.open : []);
        if (shown.has(index)) shown.delete(index);
        else shown.add(index);
        return { text, open: shown };
      }),
    [text],
  );

  // What each group's own JSON is, worked out for the tab that is showing it
  // and not the other: the tools are a pool of schemas to colour and the
  // conversation is megabytes of one, so neither is worth doing for a pane that
  // is not the one on screen.
  const bodies = useMemo(
    () =>
      tab === "tools"
        ? groups.map((group) => {
            const bytes = costs.find((cost) => cost.server === group.id)?.bytes ?? toolBytes(group.tools);
            const count = group.tools.length;
            return {
              group,
              meta: `${count === 1 ? "1 tool" : `${count} tools`} ~${tokens(bytes)} Tok`,
              body: highlight(JSON.stringify(group.tools, null, 2), open, expand),
            };
          })
        : [],
    [tab, groups, costs, open, expand],
  );
  const body = useMemo(
    () => (tab === "history" ? highlight(text, open, expand) : null),
    [tab, text, open, expand],
  );

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
