import { useEffect, useState, type ReactNode } from "react";
import { Globe, Plus, Terminal } from "lucide-react";
import * as api from "../api";
import type { McpReport, McpServer } from "../types";
import { useSaved } from "../useSaved";
import { AddButton, Checkbox, Field, IconButton } from "./Controls";
import { RowDelete, useDeleteQuestion } from "./RowDelete";

/**
 * One row of a header or environment list, while it is being edited. The wire
 * holds these as maps; a row is used here because a map cannot hold the empty
 * name a row is born with, and would drop the row the moment it is typed into.
 */
interface KeyValue {
  key: string;
  value: string;
}

/** The fields every server has, whichever transport it speaks. */
interface DraftBase {
  id: string;
  name: string;
  enabled: boolean;
  /** Whether the server is imported lazily: its tools are not offered to a chat
   *  until the model asks for them, and until then the system prompt carries its
   *  name and description in their place. */
  lazy: boolean;
  /** What the model is told it is, while it is lazy. */
  description: string;
  /**
   * Whether the server runs its tools without asking. It is carried through a
   * save but not offered here: running a tool is an action taken on the user's
   * behalf, and the protocol asks hosts to obtain consent for each one, so the
   * pane always asks — a line in `mcp.json` is what says otherwise.
   */
  autoRun: boolean;
}

/**
 * A server while the form holds it. It is the same shape as `McpServer`, with
 * the two transports kept as the union they are: an http draft has no command,
 * a stdio draft has no url, so a switch between them cannot carry either into
 * the other's fields.
 */
type Draft =
  | (DraftBase & { type: "http"; url: string; headers: KeyValue[] })
  | (DraftBase & { type: "stdio"; command: string; args: string; env: KeyValue[] });

/** A stored server as the form holds it. A map becomes rows in the order it was
    written; the args list becomes one line per argument. */
function fromServer(server: McpServer): Draft {
  const base: DraftBase = {
    id: server.id,
    name: server.name,
    enabled: server.enabled,
    lazy: server.lazy,
    description: server.description,
    autoRun: server.autoRun,
  };
  return server.transport.type === "http"
    ? {
        ...base,
        type: "http",
        url: server.transport.url,
        headers: Object.entries(server.transport.headers).map(([key, value]) => ({ key, value })),
      }
    : {
        ...base,
        type: "stdio",
        command: server.transport.command,
        args: server.transport.args.join("\n"),
        env: Object.entries(server.transport.env).map(([key, value]) => ({ key, value })),
      };
}

/** The form's draft as the wire holds it: rows back to maps, and the args field
    — one argument per line, blanks dropped — back to the list. A row whose name
    is still blank is not a header yet, so it is left out. */
function toServer(draft: Draft): McpServer {
  const base = {
    id: draft.id,
    name: draft.name,
    enabled: draft.enabled,
    lazy: draft.lazy,
    description: draft.description,
    autoRun: draft.autoRun,
  };
  return draft.type === "http"
    ? {
        ...base,
        transport: {
          type: "http",
          url: draft.url,
          headers: Object.fromEntries(
            draft.headers.filter((r) => r.key !== "").map((r) => [r.key, r.value]),
          ),
        },
      }
    : {
        ...base,
        transport: {
          type: "stdio",
          command: draft.command,
          args: draft.args
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line !== ""),
          env: Object.fromEntries(
            draft.env.filter((r) => r.key !== "").map((r) => [r.key, r.value]),
          ),
        },
      };
}

/** The ID a name is given while it is still the name's own: the name in the one
    word the protocol wants, lowercased, with everything that is not a letter or
    a digit standing in as the hyphen between words. The design says so under the
    two fields — the ID follows the name until it is changed by hand. */
function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Why the list cannot be written, or `""` when it can. */
function problem(list: Draft[]): string {
  const seen = new Set<string>();
  for (const server of list) {
    const id = server.id.trim();
    if (id === "") return "A server has no ID. Every server needs one.";
    // The id names the server's tools — `<id>__<tool>` — so it has to be one
    // word: a space in it would be flattened into the name the model calls, and
    // two ids would then be able to come out the same.
    if (/\s/.test(id)) return `The ID "${id}" has a space in it. An ID is one word.`;
    if (server.name.trim() === "") return `The server "${id}" has no name.`;
    // A lazy server is a name and a description until it is loaded: with nothing
    // written about it there is nothing for the model to decide by, so a lazy
    // server without one is not a server that can be left lazy.
    if (server.lazy && server.description.trim() === "")
      return `The lazy server "${id}" has no description. The model reads that instead of its tools.`;
    if (server.type === "http" && server.url.trim() === "")
      return `The HTTP server "${id}" has no URL.`;
    if (server.type === "stdio" && server.command.trim() === "")
      return `The stdio server "${id}" has no command.`;
    if (seen.has(id)) return `Two servers share the ID "${id}". IDs must be unique.`;
    seen.add(id);
  }
  return "";
}

/**
 * One server in the list: the name that opens it, whether it is switched on, and
 * the bin that removes it — the history's rows, in the protocol's own list. The
 * question the bin asks is the same one the history asks, from the same place.
 */
function McpRow({
  server,
  active,
  onOpen,
  onDelete,
}: {
  server: Draft;
  active: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const { asking, ask, giveUp } = useDeleteQuestion();
  return (
    <div className={`mcp-row row${active ? " active" : ""}${asking ? " confirming" : ""}`}>
      {asking ? (
        <span className="mcp-row-name">Delete this server?</span>
      ) : (
        <button className="mcp-row-name" onClick={onOpen}>
          {server.name || "Untitled"}
        </button>
      )}
      {/* A server that is switched off is still listed, and says so in passing —
          unless the question is up, where the answers are all there is room for. */}
      {!asking && !server.enabled && <span className="mcp-row-off">Disabled</span>}
      <RowDelete
        asking={asking}
        label={`Delete "${server.name || "this server"}"`}
        ask={ask}
        giveUp={giveUp}
        onDelete={onDelete}
      />
    </div>
  );
}

/**
 * The MCP tab: the servers `mcp.json` holds, down the left, and the one that is
 * open on the right. Nothing here writes `settings.yaml` — the pane saves
 * `mcp.json` itself, so it keeps its own Save rather than the window's.
 *
 * The open server is a draft that is not the list: a server enters the list when
 * it is saved, and a change to one that is already there is only written when
 * Save is pressed. Deleting is the one thing that is not drafted — the bin asks
 * its question and then removes the server from the file — because a row that
 * disappeared while the file still held it would be a lie about what the app
 * will start on its next read.
 */
export function McpSettings() {
  // Null until the file has been read.
  const [servers, setServers] = useState<Draft[] | null>(null);
  // What is open on the right, if anything.
  const [draft, setDraft] = useState<Draft | null>(null);
  // Where the open draft was read from, or null for a server that is not in the
  // file yet.
  const [from, setFrom] = useState<number | null>(null);
  const [error, setError] = useState("");
  /** Whether the open draft's ID is still the name's own: true for a server that
   *  is not in the file yet, until the ID is typed into by hand. */
  const [followId, setFollowId] = useState(false);
  // Set by a save and cleared by its own timer: a receipt for what just
  // happened, not a state the page is in.
  const { saved, flash } = useSaved();
  const [busy, setBusy] = useState(false);
  // What the last test answered. Selecting another server leaves it behind
  // rather than showing one server's tools under another's name.
  const [result, setResult] = useState<{ report?: McpReport; error?: string } | null>(null);

  useEffect(() => {
    api
      .mcpServers()
      .then((list) => {
        const drafts = list.map(fromServer);
        setServers(drafts);
        // The first server is the one the pane opens on, so the page is never a
        // list beside an empty column.
        if (drafts.length > 0) show(drafts, 0);
      })
      .catch((e) => {
        setError(String(e));
        setServers([]);
      });
  }, []);

  /** Opens one server of `list` for editing. Its ID is its own: a server in the
      file has been named already, and the name does not get to rename it. */
  function show(list: Draft[], at: number) {
    const server = list[at];
    if (!server) return;
    setDraft(server);
    setFrom(at);
    setFollowId(false);
    setResult(null);
  }

  /** Rewrites the open draft; nothing is written until Save. */
  function patch(next: Partial<Draft>) {
    setDraft((d) => (d ? ({ ...d, ...next } as Draft) : d));
  }

  /** Types into the name, carrying it into the ID for as long as the ID is the
      name's own. */
  function setName(name: string) {
    patch(followId ? { name, id: slug(name) } : { name });
  }

  /** Types into the ID: from here it is the reader's, whatever the name does. */
  function setId(id: string) {
    setFollowId(false);
    patch({ id });
  }

  /** Switches the open server's transport. The two variants share no field, so
      the new one starts empty rather than wearing the old one's leftovers; the
      one already chosen is not switched to, since that would be the same thing
      as clearing it. */
  function setType(type: Draft["type"]) {
    setDraft((d) => {
      if (!d || d.type === type) return d;
      const base: DraftBase = {
        id: d.id,
        name: d.name,
        enabled: d.enabled,
        lazy: d.lazy,
        description: d.description,
        autoRun: d.autoRun,
      };
      return type === "http"
        ? { ...base, type: "http", url: "", headers: [] }
        : { ...base, type: "stdio", command: "", args: "", env: [] };
    });
    setResult(null);
  }

  /** Starts a server that is not in the file: it is listed once it is saved. The
      form is empty, the name included, so the fields are the design's own
      placeholders; the ID follows the name until it is typed into. */
  function add() {
    setDraft({
      id: "",
      name: "",
      enabled: true,
      // The file's own defaults, so a server started here is the server the file
      // would have made: it runs its tools as the model asks, and its tools are
      // offered to every chat rather than held back for a load.
      autoRun: true,
      lazy: false,
      description: "",
      type: "http",
      url: "",
      headers: [],
    });
    setFrom(null);
    setFollowId(true);
    setResult(null);
  }

  /** Removes a server from the file, there and then. */
  async function remove(at: number) {
    if (!servers) return;
    setBusy(true);
    try {
      const written = await api.mcpSaveServers(
        servers.filter((_, i) => i !== at).map(toServer),
      );
      const list = written.map(fromServer);
      setServers(list);
      // What was open stays open, unless it is what went: then the first of what
      // is left takes its place, and an emptied list leaves the pane on nothing.
      if (from === at) show(list, 0);
      else setFrom(from === null ? null : from > at ? from - 1 : from);
      setError("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!draft || !servers) return;
    // The list as it would be written: everything else, and the draft in the
    // place of the server it came from.
    const next = from === null ? [...servers, draft] : servers.map((s, i) => (i === from ? draft : s));
    const why = problem(next);
    if (why !== "") {
      setError(why);
      return;
    }
    setBusy(true);
    try {
      const written = await api.mcpSaveServers(next.map(toServer));
      const list = written.map(fromServer);
      setServers(list);
      show(list, from === null ? list.length - 1 : from);
      setError("");
      flash();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  /** Asks the open server what it offers, as it is on screen — unsaved. */
  async function test() {
    if (!draft) return;
    setBusy(true);
    try {
      setResult({ report: await api.mcpTest(toServer(draft)) });
    } catch (e) {
      setResult({ error: String(e) });
    } finally {
      setBusy(false);
    }
  }

  if (servers === null) return <p className="mcp-empty">Reading mcp.json…</p>;

  return (
    <div className="mcp">
      <div className="mcp-list">
        <AddButton className="mcp-new" label="New server" onClick={add} />
        {servers.map((server, i) => (
          // Keyed by the server rather than by its place: a row is a row about
          // *that* server, and the question it may be asking belongs to it — a
          // list keyed by position hands the row's state to whichever server
          // slides into the place of one that was removed.
          <McpRow
            key={server.id}
            server={server}
            active={from === i}
            onOpen={() => show(servers, i)}
            onDelete={() => remove(i)}
          />
        ))}
      </div>

      <div className="mcp-divider" />

      <div className="mcp-detail">
        {error !== "" && <p className="notice">{error}</p>}

        {!draft ? (
          <p className="mcp-empty">
            {servers.length === 0
              ? "No servers yet — New server adds one."
              : "Pick a server on the left, or add one."}
          </p>
        ) : (
          <>
            {/* How the server is reached: the two transports as the cards that
                choose between them, then the field the chosen one is addressed
                by. */}
            <section className="mcp-section">
              <div className="mcp-head-row">
                <div className="mcp-section-head">
                  <h3 className="mcp-section-title">Connection</h3>
                  <p className="mcp-section-sub">How Chalk reaches this server.</p>
                </div>

                {/* What writes the server, on the form's own first line rather
                    than at the foot of a column that scrolls: a form is read from
                    the top, and the one control that ends it is the one that
                    should not have to be found by scrolling to the end of it. It
                    writes the whole server — the details and the behaviour as
                    much as the connection — which is why it heads the form rather
                    than belonging to this section or that. The receipt stands
                    beside it, where the press was, and before it rather than
                    after: the button holds the form's own right-hand edge, so the
                    word coming and going moves nothing. */}
                <div className="mcp-footer">
                  {saved && <span className="saved">Saved</span>}
                  <button className="btn btn--primary" onClick={save} disabled={busy}>
                    {from === null ? "Add server" : "Save"}
                  </button>
                </div>
              </div>

              <div className="mcp-types">
                <TransportCard
                  icon={<Globe />}
                  title="Remote server"
                  badge="HTTP"
                  text="Chalk connects to a URL. For hosted services you sign in to."
                  example="e.g. Linear, GitHub, Notion"
                  chosen={draft.type === "http"}
                  onChoose={() => setType("http")}
                />
                <TransportCard
                  icon={<Terminal />}
                  title="Local program"
                  badge="stdio"
                  text="Chalk starts a command on this computer and talks to it."
                  example="e.g. Filesystem, Git, a script of your own"
                  chosen={draft.type === "stdio"}
                  onChoose={() => setType("stdio")}
                />
              </div>

              {draft.type === "http" ? (
                <Field label="Server URL">
                  <input
                    type="text"
                    className="input"
                    value={draft.url}
                    placeholder="https://example.com/mcp"
                    spellCheck={false}
                    onChange={(e) => patch({ url: e.target.value })}
                  />
                </Field>
              ) : (
                <>
                  <Field label="Command">
                    <input
                      type="text"
                      className="input"
                      value={draft.command}
                      placeholder="npx"
                      spellCheck={false}
                      onChange={(e) => patch({ command: e.target.value })}
                    />
                  </Field>
                  <Field label="Args">
                    <textarea
                      className="input input--area"
                      rows={3}
                      value={draft.args}
                      placeholder="One argument per line"
                      spellCheck={false}
                      onChange={(e) => patch({ args: e.target.value })}
                    />
                  </Field>
                </>
              )}
            </section>

            {/* What the server is handed with every message, and the one place
                the connection is tried from. */}
            <section className="mcp-section">
              {draft.type === "http" ? (
                <div className="mcp-kv-block">
                  <KeyValueList
                    label="HTTP headers"
                    noun="header"
                    rows={draft.headers}
                    onChange={(headers) => patch({ headers })}
                  />
                  <p className="settings-note">
                    Optional. Most servers that need a sign-in take an Authorization
                    header.
                  </p>
                </div>
              ) : (
                <div className="mcp-kv-block">
                  <KeyValueList
                    label="Environment"
                    noun="variable"
                    rows={draft.env}
                    onChange={(env) => patch({ env })}
                  />
                  <p className="settings-note">
                    Optional. What the program is handed as its environment.
                  </p>
                </div>
              )}

              <ConnectionTest draft={draft} busy={busy} result={result} onTest={test} />
            </section>

            <div className="mcp-rule" />

            {/* What the server is called, and what the model is told about it. */}
            <section className="mcp-section">
              <h3 className="mcp-section-title">Details</h3>

              <div className="settings-row">
                <Field label="Name">
                  <input
                    type="text"
                    className="input"
                    value={draft.name}
                    placeholder="Linear, Local files, …"
                    onChange={(e) => setName(e.target.value)}
                  />
                </Field>
                <Field label="ID">
                  <input
                    type="text"
                    className="input"
                    value={draft.id}
                    placeholder="linear"
                    spellCheck={false}
                    onChange={(e) => setId(e.target.value)}
                  />
                </Field>
              </div>
              <p className="settings-note">
                The ID prefixes this server's tools — <code>id__tool</code> — so it is one
                word. It follows the name until you change it.
              </p>

              <Field label="Description">
                <input
                  type="text"
                  className="input"
                  value={draft.description}
                  placeholder="What it holds, in the model's own words"
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </Field>
              <p className="settings-note">
                Tells the model what this server is for. A lazy server needs one: it is
                all the model sees until it loads the tools.
              </p>
            </section>

            <div className="mcp-rule" />

            {/* How the server behaves: whether it is offered at all, and whether
                its tools wait for the model to ask for them. */}
            <section className="mcp-section">
              <h3 className="mcp-section-title">Behaviour</h3>
              <Checkbox
                checked={draft.enabled}
                label="Enabled"
                onChange={(enabled) => patch({ enabled })}
              />
              <Checkbox
                checked={draft.lazy}
                label="Import lazily"
                onChange={(lazy) => patch({ lazy })}
              />
            </section>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * A list of names and values, which is what a server's headers are, and its
 * environment too. Rows are kept in the order they are shown; the `+` beside the
 * label appends an empty one, and each row can be dropped.
 */
function KeyValueList({
  label,
  noun,
  rows,
  onChange,
}: {
  label: string;
  /** What one row is called, for the buttons that add and remove them. */
  noun: string;
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
}) {
  return (
    <div className="mcp-kv">
      <div className="mcp-kv-head">
        <span className="field-label">{label}</span>
        <button
          className="btn btn--subtle btn--icon-sm"
          title={`Add ${noun}`}
          aria-label={`Add ${noun}`}
          onClick={() => onChange([...rows, { key: "", value: "" }])}
        >
          <Plus />
        </button>
      </div>
      {rows.map((row, i) => (
        <div className="mcp-kv-row" key={i}>
          <input
            type="text"
            className="input"
            value={row.key}
            placeholder="Name"
            spellCheck={false}
            aria-label={`${label} name ${i + 1}`}
            onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
          />
          <input
            type="text"
            className="input"
            value={row.value}
            placeholder="Value"
            spellCheck={false}
            aria-label={`${label} value ${i + 1}`}
            onChange={(e) =>
              onChange(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
            }
          />
          <IconButton
            className="btn btn--quiet btn--icon btn--stretch"
            title={`Remove ${row.key || "this row"}`}
            ariaLabel={`Remove ${row.key || "this row"}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
    </div>
  );
}

/**
 * One of the two transports, drawn as the card that chooses it: the mark, what
 * the transport is, what it does, and who it is for. The one in force is ruled
 * in the page's own ink rather than the hairline, since a fill would make it
 * another kind of surface.
 */
function TransportCard({
  icon,
  title,
  badge,
  text,
  example,
  chosen,
  onChoose,
}: {
  icon: ReactNode;
  title: string;
  /** The word the protocol knows the transport by, written where ids are. */
  badge: string;
  text: string;
  example: string;
  chosen: boolean;
  onChoose: () => void;
}) {
  return (
    <button className={chosen ? "mcp-type on" : "mcp-type"} aria-pressed={chosen} onClick={onChoose}>
      <span className="mcp-type-icon">{icon}</span>
      <span className="mcp-type-body">
        <span className="mcp-type-head">
          <span className="mcp-type-title">{title}</span>
          <span className="mcp-type-badge">{badge}</span>
        </span>
        <span className="mcp-type-text">{text}</span>
        <span className="mcp-type-eg">{example}</span>
      </span>
    </button>
  );
}

/**
 * The connection, tried where it is written: the state the server is in —
 * nothing to try it with yet, ready, being asked, answered, refused — the
 * button that asks it, and, under both, what it answered with.
 */
function ConnectionTest({
  draft,
  busy,
  result,
  onTest,
}: {
  draft: Draft;
  busy: boolean;
  result: { report?: McpReport; error?: string } | null;
  onTest: () => void;
}) {
  // What there is to reach: the URL of an HTTP server, the command of one run
  // here. With neither, there is nothing to try.
  const address = draft.type === "http" ? draft.url.trim() : draft.command.trim();
  const report = result?.report;

  let state = "";
  let title: string;
  let sub: string;
  if (address === "") {
    title = "Not ready to test";
    sub =
      draft.type === "http"
        ? "Add a server URL to test the connection."
        : "Add a command to test the connection.";
  } else if (busy) {
    title = "Asking the server…";
    sub = "Waiting for it to answer.";
  } else if (result?.error) {
    state = " bad";
    title = "The server did not answer";
    sub = result.error;
  } else if (report) {
    state = " ok";
    const tools = report.tools.length;
    title =
      [report.serverName, report.serverVersion].filter(Boolean).join(" ") ||
      "The server answered";
    sub = `${tools} ${tools === 1 ? "tool" : "tools"} · protocol ${report.protocol}`;
  } else {
    title = "Ready to test";
    sub = address;
  }

  return (
    <div className="mcp-test">
      <div className="mcp-test-row">
        <div className="mcp-test-status">
          <span className={`mcp-test-dot${state}`} aria-hidden="true" />
          <div className="mcp-test-text">
            <span className="mcp-test-title">{title}</span>
            <span className="mcp-test-sub">{sub}</span>
          </div>
        </div>
        <button className="btn btn--secondary" disabled={address === "" || busy} onClick={onTest}>
          Test connection
        </button>
      </div>

      {report &&
        (report.tools.length === 0 ? (
          <p className="mcp-empty">The server offers no tools.</p>
        ) : (
          <ul className="mcp-tools">
            {report.tools.map((tool) => (
              <li className="mcp-tool" key={tool.name}>
                <span className="mcp-tool-title">{tool.title || tool.name}</span>
                <span className="mcp-tool-name">{tool.name}</span>
                {tool.description && <p className="mcp-tool-desc">{tool.description}</p>}
              </li>
            ))}
          </ul>
        ))}
    </div>
  );
}
