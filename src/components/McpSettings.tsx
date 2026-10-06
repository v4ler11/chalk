import { useEffect, useState } from "react";
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

  /** Opens one server of `list` for editing. */
  function show(list: Draft[], at: number) {
    const server = list[at];
    if (!server) return;
    setDraft(server);
    setFrom(at);
    setResult(null);
  }

  /** Rewrites the open draft; nothing is written until Save. */
  function patch(next: Partial<Draft>) {
    setDraft((d) => (d ? ({ ...d, ...next } as Draft) : d));
  }

  /** Switches the open server's transport. The two variants share no field, so
      the new one starts empty rather than wearing the old one's leftovers. */
  function setType(type: Draft["type"]) {
    setDraft((d) => {
      if (!d) return d;
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

  /** Starts a server that is not in the file: it is listed once it is saved. */
  function add() {
    setDraft({
      id: "",
      name: "New server",
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
            <p className="settings-note">
              Its tools are held back until the model asks for them with{" "}
              <code>load_lazy_mcp</code>; until then all it is given is the name and the
              description below.
            </p>

            <div className="settings">
              <Field label="Type">
                <select value={draft.type} onChange={(e) => setType(e.target.value as Draft["type"])}>
                  <option value="http">HTTP Server (http)</option>
                  <option value="stdio">stdio Server (stdio)</option>
                </select>
              </Field>

              <div className="settings-row">
                <Field label="Name">
                  <input
                    type="text"
                    value={draft.name}
                    placeholder="What the list calls it"
                    onChange={(e) => patch({ name: e.target.value })}
                  />
                </Field>
                <Field label="ID">
                  <input
                    type="text"
                    value={draft.id}
                    placeholder="github, filesystem, …"
                    spellCheck={false}
                    onChange={(e) => patch({ id: e.target.value })}
                  />
                </Field>
              </div>
              <p className="settings-note">
                Names the server in tool names — <code>&lt;id&gt;__&lt;tool&gt;</code> — so it is
                one word.
              </p>

              <Field label="Description">
                <input
                  type="text"
                  value={draft.description}
                  placeholder="What it holds, in the model's own words"
                  onChange={(e) => patch({ description: e.target.value })}
                />
              </Field>
              <p className="settings-note">
                What the model reads where a lazy server's tools would be, and what it has to
                decide by when it is loading one.
              </p>

              {draft.type === "http" ? (
                <>
                  <Field label="URL">
                    <input
                      type="text"
                      value={draft.url}
                      placeholder="https://example.com/mcp"
                      spellCheck={false}
                      onChange={(e) => patch({ url: e.target.value })}
                    />
                  </Field>
                  <KeyValueList
                    label="HTTP headers"
                    noun="header"
                    rows={draft.headers}
                    onChange={(headers) => patch({ headers })}
                  />
                </>
              ) : (
                <>
                  <Field label="Command">
                    <input
                      type="text"
                      value={draft.command}
                      placeholder="npx"
                      spellCheck={false}
                      onChange={(e) => patch({ command: e.target.value })}
                    />
                  </Field>
                  <Field label="Args">
                    <textarea
                      rows={3}
                      value={draft.args}
                      placeholder="One argument per line"
                      spellCheck={false}
                      onChange={(e) => patch({ args: e.target.value })}
                    />
                  </Field>
                  <KeyValueList
                    label="Environment"
                    noun="variable"
                    rows={draft.env}
                    onChange={(env) => patch({ env })}
                  />
                </>
              )}
            </div>

            {result &&
              (result.report ? (
                <Report report={result.report} />
              ) : (
                <p className="notice">{result.error}</p>
              ))}

            <div className="mcp-actions">
              <button className="mcp-primary" onClick={save} disabled={busy}>
                Save
              </button>
              <button className="mcp-secondary" onClick={test} disabled={busy}>
                Test server
              </button>
              {saved && <span className="saved">Saved</span>}
            </div>
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
        <span className="settings-label">{label}</span>
        <AddButton
          className="mcp-kv-add"
          title={`Add ${noun}`}
          ariaLabel={`Add ${noun}`}
          onClick={() => onChange([...rows, { key: "", value: "" }])}
        />
      </div>
      {rows.map((row, i) => (
        <div className="mcp-kv-row" key={i}>
          <input
            type="text"
            value={row.key}
            placeholder="Name"
            spellCheck={false}
            aria-label={`${label} name ${i + 1}`}
            onChange={(e) => onChange(rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r)))}
          />
          <input
            type="text"
            value={row.value}
            placeholder="Value"
            spellCheck={false}
            aria-label={`${label} value ${i + 1}`}
            onChange={(e) =>
              onChange(rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r)))
            }
          />
          <IconButton
            className="mcp-kv-remove"
            title={`Remove ${row.key || "this row"}`}
            ariaLabel={`Remove ${row.key || "this row"}`}
            onClick={() => onChange(rows.filter((_, j) => j !== i))}
          />
        </div>
      ))}
    </div>
  );
}

/** What a server answered when it was asked what it offers. */
function Report({ report }: { report: McpReport }) {
  return (
    <div className="mcp-report">
      <div className="mcp-report-head">
        <span className="mcp-report-name">
          {report.serverName}
          {report.serverVersion && ` ${report.serverVersion}`}
        </span>
        <span className="mcp-report-protocol">protocol {report.protocol}</span>
      </div>
      {report.tools.length === 0 ? (
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
      )}
    </div>
  );
}
