// A scratch page for the window's surfaces — the composer's controls and their
// menus, the history's rows, the settings sections — so one can be looked at, and
// driven, without the desktop window. Not part of the app: `harness.html` is the
// only thing that loads it.
import ReactDOM from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import App from "./App";
import { Composer } from "./components/Composer";
import { ChannelRowItem } from "./components/ChannelRow";
import { ChatMessage } from "./components/ChatMessage";
import { ChatNav } from "./components/ChatNav";
import { JsonView, JSON_SECTIONS, type JsonTab } from "./components/JsonView";
import { MessageList } from "./components/MessageList";
import { PinsView } from "./components/PinsView";
import { SettingsView } from "./components/SettingsView";
import { SectionNav } from "./components/SectionNav";
import { Sidebar } from "./components/Sidebar";
import { ToolApproval } from "./components/ToolApproval";
import { installTheme } from "./theme";
import { settingsModel } from "./conversation";
import type { ChannelRow } from "./feed";
import { buildRows } from "./feed";
import type {
  AppConfig,
  ChatSummary,
  McpCost,
  McpFailure,
  McpReport,
  McpServer,
  McpTool,
  Partial,
  ReasoningLevel,
  RunSnapshot,
  RunSummary,
  UiMessage,
  Usage,
} from "./types";
import "katex/dist/katex.min.css";
import "./App.css";

/** The servers the tools control can hold: two that answer, one that answers and
 *  is imported lazily, one that does not, and one the settings window has
 *  switched off. */
const SERVERS: McpServer[] = [
  {
    id: "ledger",
    name: "Ledger",
    enabled: true,
    autoRun: false,
    lazy: false,
    description: "",
    transport: { type: "stdio", command: "ledger", args: [], env: {} },
  },
  {
    id: "orchard",
    name: "Orchard",
    enabled: true,
    autoRun: true,
    lazy: false,
    description: "",
    transport: { type: "http", url: "http://localhost:7317/mcp", headers: {} },
  },
  {
    id: "notes",
    name: "Notes",
    enabled: true,
    autoRun: true,
    lazy: true,
    description: "Notes and lists kept between chats",
    transport: { type: "http", url: "http://localhost:7319/mcp", headers: {} },
  },
  {
    id: "archive",
    name: "Archive",
    enabled: true,
    autoRun: false,
    lazy: false,
    description: "",
    transport: { type: "http", url: "http://localhost:7318/mcp", headers: {} },
  },
  {
    id: "files",
    name: "Files",
    enabled: false,
    autoRun: false,
    lazy: false,
    description: "",
    transport: { type: "stdio", command: "files", args: [], env: {} },
  },
];

const TOOLS: McpTool[] = [
  ...Array.from({ length: 11 }, (_, i) => ({
    name: `ledger__t${i}`,
    server: "ledger",
    serverName: "Ledger",
    title: `t${i}`,
    description: "",
    parameters: {},
    autoRun: false,
  })),
  ...Array.from({ length: 12 }, (_, i) => ({
    name: `orchard__t${i}`,
    server: "orchard",
    serverName: "Orchard",
    title: `t${i}`,
    description: "",
    parameters: {},
    autoRun: true,
  })),
  ...Array.from({ length: 3 }, (_, i) => ({
    name: `notes__t${i}`,
    server: "notes",
    serverName: "Notes",
    title: `t${i}`,
    description: "",
    parameters: {},
    autoRun: true,
  })),
];

const FAILURES: McpFailure[] = [
  { server: "archive", name: "Archive", message: "connection refused" },
];

/** What the answering servers cost: the ledger's is the real price of its eleven
 *  tools, so the row reads here as it does in the window. */
const COSTS: McpCost[] = [
  { server: "ledger", bytes: 17_328 },
  { server: "orchard", bytes: 6_424 },
  { server: "notes", bytes: 1_240 },
];

/** What this chat has loaded: nothing, so the lazy server's row reads as lazy.
 *  Put `"notes"` here to see the same row once it has been loaded. */
const LOADED: string[] = [];

/** A turn that went round three times: a lazily imported server loaded first,
 *  then a long query the way a model writes them and a plain call, then the
 *  answer — which is where all three rounds' reasoning is read. */
const TOOL_TURN: UiMessage[] = [
  { role: "user", content: "what did I spend on electricity?", sentAt: Date.now() - 4 * 60_000 },
  {
    role: "assistant",
    content: "",
    reasoning: "The ledger is imported lazily, so I have to load it before I can ask it anything.",
    waitMs: 1300,
    thinkingMs: 100,
    tool_calls: [
      {
        type: "function",
        id: "call_load",
        function: { name: "load_lazy_mcp", arguments: '{"name":"ledger"}' },
      },
    ],
  },
  {
    role: "tool",
    tool_call_id: "call_load",
    name: "load_lazy_mcp",
    ms: 0,
    content: "The ledger server is loaded. Its tools can be called from now on.",
  },
  {
    role: "assistant",
    content: "",
    reasoning: "The user is asking about their electricity bills, so I should query the ledger.",
    waitMs: 1600,
    thinkingMs: 100,
    usage: { prompt_tokens: 1204, completion_tokens: 40, total_tokens: 1244, cost: 0.0009 },
    tool_calls: [
      {
        type: "function",
        id: "call_1",
        function: {
          name: "ledger__run_query",
          arguments:
            '{"query":"SELECT date, payee, narration, position WHERE payee ~ \'EDP|edp\' OR narration ~ \'EDP|edp\' OR account ~ \'Utilities|Electricity\' ORDER BY date DESC LIMIT 20"}',
        },
      },
      { type: "function", id: "call_2", function: { name: "ledger__list_accounts", arguments: "{}" } },
      // One nothing has answered: how a call looks while it runs, or while it
      // waits on the approval card.
      {
        type: "function",
        id: "call_3",
        function: { name: "ledger__balance", arguments: '{"account":"Assets:Mono:EUR"}' },
      },
    ],
  },
  {
    role: "tool",
    tool_call_id: "call_1",
    name: "ledger__run_query",
    ms: 412,
    content:
      "date\tpayee\tnarration\tposition\n2026-09-11\tEDP Comercial\tElectricity bill (16.08.2026 a 10.09.2026)\tt66.92 EUR\n2026-09-09\tEDP Comercial\tElectricity bill (Fatura 164006964908)\tt108.02 EUR",
  },
  {
    role: "tool",
    tool_call_id: "call_2",
    name: "ledger__list_accounts",
    ms: 96,
    content: '{"content":[{"type":"text","text":"Assets:Cash:EUR\\nAssets:Mono:EUR\\nAssets:Monzo:GBP"}]}',
  },
  {
    role: "assistant",
    content:
      "**Assets**\n\n- Cash: `Assets:Cash:EUR`\n  - the card it is drawn from\n  - its savings account\n- Mono (UA): `Assets:Mono:EUR`, `Assets:Mono:UAH`\n\nThe bills came out of them in this order, and the ledger numbers the old ones\nfrom where its own list began:\n\n1. `Assets:Mono:EUR`\n2. `Assets:Cash:EUR`\n\nAnd the older bills:\n\n4. `Assets:Cash:EUR`\n5. `Assets:Mono:UAH`",
    reasoning: "Two electricity bills came back, so the answer is the accounts they were paid from.",
    waitMs: 1200,
    thinkingMs: 300,
    usage: { prompt_tokens: 1600, completion_tokens: 90, total_tokens: 1690, cost: 0.0013 },
  },
];

/** The pinned threads the list is drawn from: one with replies, one with none, and
 *  one pinned long enough ago that the row's line reads as a date. */
const PINS: ChatSummary[] = [
  {
    id: 3,
    title: "Which accounts paid the two electricity bills?",
    updatedAt: Date.now() - 4 * 60_000,
    model: "deepseek/deepseek-v4.1-flash",
    reasoning: "",
    createdAt: Date.now() - 30 * 60_000,
    root: "Which accounts paid the two electricity bills?",
    replies: 3,
    mine: 1,
    images: 0,
    pinnedAt: Date.now() - 3 * 60_000,
  },
  {
    id: 1,
    title: "A prompt long enough that the row under it has to say less than all of it",
    updatedAt: Date.now() - 26 * 60 * 60_000,
    model: "google/gemini-3.8-flash",
    reasoning: "medium",
    createdAt: Date.now() - 27 * 60 * 60_000,
    root: "A prompt long enough that the row under it has to say less than all of it, so that the words of it run past what a row of the list holds and are cut off rather than wrapped down the page.",
    replies: 0,
    mine: 0,
    images: 2,
    pinnedAt: Date.now() - 25 * 60 * 60_000,
  },
  {
    id: 2,
    title: "An older thread",
    updatedAt: Date.now() - 3 * 24 * 60 * 60_000,
    model: "deepseek/deepseek-v4.1-flash",
    reasoning: "",
    createdAt: Date.now() - 4 * 24 * 60 * 60_000,
    root: "An older thread",
    replies: 1,
    mine: 0,
    images: 0,
    pinnedAt: Date.now() - 3 * 24 * 60 * 60_000,
  },
];

/** The rows the feed block is drawn from: one pinned, one not, one that is
 *  thinking, so both readings of the row's menu can be looked at. */
const FEED: ChannelRow[] = [
  {
    chat: 3,
    root: "Which accounts paid the two electricity bills?",
    createdAt: Date.now() - 30 * 60_000,
    replies: 3,
    mine: 1,
    images: 0,
    model: "deepseek/deepseek-v4.1-flash",
    pinnedAt: Date.now() - 3 * 60_000,
    updatedAt: Date.now() - 4 * 60_000,
    status: "idle",
    thinking: false,
    awaiting: 0,
    active: false,
  },
  {
    chat: 4,
    root: "A thread nobody has pinned, with a longer prompt than the row holds.",
    createdAt: Date.now() - 2 * 60 * 60_000,
    replies: 0,
    mine: 0,
    images: 0,
    model: "google/gemini-3.8-flash",
    pinnedAt: 0,
    updatedAt: Date.now() - 2 * 60 * 60_000,
    status: "running",
    thinking: true,
    awaiting: 0,
    active: false,
  },
  {
    // A thread nothing has come back to yet: the case the line under it is held
    // open for, since the row must be the same height with and without it.
    chat: 5,
    root: "A new thread nothing has answered.",
    createdAt: Date.now() - 60_000,
    replies: 0,
    mine: 0,
    images: 0,
    model: "deepseek/deepseek-v4.1-flash",
    pinnedAt: 0,
    updatedAt: Date.now() - 60_000,
    status: "idle",
    thinking: false,
    awaiting: 0,
    active: false,
  },
];

/** The pinned threads the pins pane is drawn from, as the pane draws them: the
 *  channel's own rows, most recently pinned first. */
const PIN_ROWS: ChannelRow[] = buildRows(PINS, new Map(), null).sort(
  (a, b) => b.pinnedAt - a.pinnedAt,
);

/** The section the settings open on, from `?tab=`, where it names one. */
const SETTINGS_TABS = ["general", "models", "customization", "mcp"] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];
const settingsTab = new URLSearchParams(location.search).get("tab");
const SETTINGS_TAB: SettingsTab | undefined = SETTINGS_TABS.find((t) => t === settingsTab);

/** The servers the MCP page is drawn with: the design's three, one of them
 *  switched off, and one of each transport. */
const MCP_SERVERS: McpServer[] = [
  {
    id: "workspace",
    name: "Team workspace",
    enabled: true,
    autoRun: true,
    lazy: false,
    description: "The team's shared documents and tickets.",
    transport: {
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer sk-…" },
    },
  },
  {
    id: "files",
    name: "Local files",
    enabled: true,
    autoRun: true,
    lazy: false,
    description: "Reads and writes the files of this project.",
    transport: {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "."],
      env: {},
    },
  },
  {
    id: "research",
    name: "Research library",
    enabled: false,
    autoRun: true,
    lazy: false,
    description: "",
    transport: { type: "http", url: "https://research.example.com/mcp", headers: {} },
  },
];

/** What the mock server answers a test with. */
const MCP_REPORT: McpReport = {
  serverName: "chalk-harness",
  serverVersion: "1.4.0",
  protocol: "2025-06-18",
  tools: [
    {
      name: "search",
      title: "Search the workspace",
      description: "Finds documents and tickets by their text.",
    },
    { name: "fetch", title: "Fetch a document", description: "Reads one document whole." },
  ],
};

/**
 * The settings the app's own window reads, and the ones the scratch page's
 * settings block is drawn from: one gateway beside the app's own provider, so the
 * Models page is drawn with two tabs — the models whose ids lead with a gateway's
 * name under it, and everything else, OpenRouter's own vendor-prefixed ids
 * included, under OpenRouter.
 */
const APP_CONFIG: AppConfig = {
  name: "Valerii",
  provider: "openrouter",
  endpoint: "",
  apiKey: "sk-or-v1-abcdefghijklmnop",
  gateways: [
    { id: "anthropic", endpoint: "https://api.anthropic.com/v1", apiKey: "sk-ant-abcdefghij" },
  ],
  models: [
    "deepseek/deepseek-v4.1-flash",
    "google/gemini-4-argon",
    "google/gemini-3.8-flash",
    "x-ai/grok-4",
    "local-llama",
    "anthropic/claude-sonnet-4.5",
  ],
  // A model that is deliberately not the head of the list: the page has to show
  // the default where the list does not, and the picker has to keep its order.
  defaultModel: "google/gemini-3.8-flash",
  systemPrompt: "Answer in one line.",
};

/** The history the app's own window reads: two threads, one of them pinned, so
 *  the feed, the pins and a thread opened from either of them have something to
 *  be drawn from. */
const APP_CHATS: ChatSummary[] = [
  {
    id: 1,
    title: "What did I spend on electricity?",
    updatedAt: Date.now() - 4 * 60_000,
    model: "deepseek/deepseek-v4.1-flash",
    reasoning: "medium",
    createdAt: Date.now() - 6 * 60_000,
    root: "what did I spend on electricity?",
    replies: 1,
    mine: 0,
    images: 0,
    pinnedAt: Date.now() - 2 * 60_000,
  },
  {
    id: 2,
    title: "A thread with nothing pinned about it",
    updatedAt: Date.now() - 26 * 60 * 60_000,
    model: "deepseek/deepseek-v4.1-flash",
    reasoning: "",
    createdAt: Date.now() - 27 * 60 * 60_000,
    root: "A thread with nothing pinned about it",
    replies: 0,
    mine: 0,
    images: 0,
    pinnedAt: 0,
  },
];

/** One thread as the run holds it: a prompt and its answer, with nothing
 *  arriving. The driver starts the stream.
 *
 *  The answer carries the usage a provider reports with it — the tokens and the
 *  price — on the threads that have been answered, which is where the app reads
 *  a chat's spend from; a thread with no answer yet has none, the way a
 *  transcript written before the app kept usage has none. */
function appSnapshot(chat: number): RunSnapshot {
  const row = APP_CHATS.find((one) => one.id === chat) ?? APP_CHATS[0];
  return {
    chat: row.id,
    status: "idle",
    title: row.title,
    model: row.model,
    reasoning: row.reasoning,
    servers: null,
    loaded: [],
    replies: row.replies,
    mine: row.mine,
    messages: [
      { role: "user", content: row.root, sentAt: row.createdAt },
      {
        role: "assistant",
        content: "An answer.",
        waitMs: 1200,
        thinkingMs: 400,
        ...(row.replies > 0 ? { usage: ANSWERED } : {}),
      },
    ],
    partial: null,
    awaiting: [],
    error: null,
  };
}

/** What one answered request cost, in the shape a provider reports it. */
const ANSWERED: Usage = {
  prompt_tokens: 1204,
  completion_tokens: 356,
  total_tokens: 1560,
  cost: 0.021,
};

/** What the answer still arriving has cost so far. */
const ARRIVING: Usage = {
  prompt_tokens: 1310,
  completion_tokens: 120,
  total_tokens: 1430,
  cost: 0.011,
};

/**
 * The window's backend, at the boundary the app talks to: the commands the
 * window reads on the way in, and the two events a run reports itself with.
 *
 * The MCP page's own calls are among them, since they are the same window's. What
 * is left unanswered is anything a scratch page has no business faking — a send,
 * a provider, the log window — and the app's own readers catch that and say so
 * rather than the page dying on it.
 *
 * `emit` is the backend's side of an event: the event plugin registers a callback
 * per event when the window listens, and the backend calls it with the payload.
 * Driving a run is therefore driving `emit`, which is what makes a stream here
 * the same sequence of reports the Rust side sends — a delta per push, a summary
 * on every move, and the transcript read back over `run_state`.
 */
function installBackend() {
  const state = {
    servers: MCP_SERVERS,
    runs: new Map<number, RunSnapshot>([[1, appSnapshot(1)], [2, appSnapshot(2)]]),
  };
  const listeners = new Map<string, number>();
  const callbacks = new Map<number, (event: unknown) => void>();
  /** Every command the window has asked for, in order, with the events it has
   *  registered: what a driver reads to see that its reports reached the app. */
  const asked: string[] = [];
  let nextId = 1;

  const summaries = (): RunSummary[] =>
    [...state.runs.values()].map((run) => ({
      chat: run.chat,
      status: run.status,
      thinking: false,
      replies: run.replies,
      mine: run.mine,
      awaiting: run.awaiting.length,
    }));

  /** Sends one report the way Rust does, and says where it landed: a driver that
   *  sees `no listener` knows the window never asked to be told. */
  function emit(event: string, payload: unknown): "no listener" | "no callback" | "delivered" {
    const handler = listeners.get(event);
    if (handler === undefined) return "no listener";
    const callback = callbacks.get(handler);
    if (!callback) return "no callback";
    callback({ event, id: handler, payload });
    return "delivered";
  }

  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args?: Record<string, unknown>) => {
      const chat = args?.chat as number | undefined;
      asked.push(cmd === "plugin:event|listen" ? `${cmd}:${String(args?.event)}` : cmd);
      switch (cmd) {
        // The event plugin: a window listening is a callback registered under the
        // id `transformCallback` handed back, and `emit` is what calls it.
        case "plugin:event|listen":
          listeners.set(args?.event as string, args?.handler as number);
          return nextId++;
        case "plugin:event|unlisten":
          return null;
        case "get_config":
          return APP_CONFIG;
        case "save_config":
          return args?.config;
        case "list_chats":
          return APP_CHATS;
        case "list_pins":
          return APP_CHATS.filter((row) => row.pinnedAt > 0);
        case "runs_state":
          return summaries();
        case "run_state":
          return chat === undefined ? null : state.runs.get(chat) ?? null;
        case "chat_set":
          return null;
        case "run_stop":
          return null;
        case "mcp_servers":
          return state.servers;
        case "mcp_save_servers":
          state.servers = (args?.servers as McpServer[]) ?? state.servers;
          return state.servers;
        case "mcp_test":
          return MCP_REPORT;
        case "mcp_tools":
          return { tools: [], failures: [], costs: [] };
        case "manage_tools":
          return [];
        case "root_images":
          return [];
        default:
          throw new Error(`the harness has no answer for ${cmd}`);
      }
    },
    transformCallback: (callback: (event: unknown) => void) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    },
    unregisterCallback: (id: number) => {
      callbacks.delete(id);
    },
    convertFileSrc: (path: string) => path,
  };

  /** The driver's side: what the backend says, and what it holds. */

  /** What Rust says when a chat's run moves: the summary of it, as the feed and
   *  the open thread read it. */
  function announce(chat: number) {
    const summary = summaries().find((one) => one.chat === chat);
    if (summary) emit("run-changed", summary);
  }

  return {
    emit,
    asked: () => [...asked],
    listening: () => [...listeners.keys()],
    config: APP_CONFIG,
    chats: APP_CHATS,
    snapshot: (chat: number) => state.runs.get(chat) ?? null,
    /** One report, as an arriving stream makes it: the answer so far, and what
     *  the provider has reported about it — the usage is what a run carries from
     *  the moment the gateway says, which is where the chat's spend is read
     *  while it is still being spent. Rust marks the run as running and says so
     *  in a summary of its own when the run starts, before any token — which is
     *  what takes the transcript's actions away — so the summary is emitted here
     *  for the first report of a run. */
    push: (chat: number, answer: string, usage: Usage | null = ARRIVING) => {
      const held = state.runs.get(chat);
      if (!held) return;
      const starting = held.status !== "running";
      state.runs.set(chat, {
        ...held,
        status: "running",
        partial: {
          startedAt: Date.now() - 1500,
          firstTokenAt: Date.now() - 1000,
          reasoning: "",
          answer,
          thinking: false,
          thinkingMs: 400,
          usage,
        },
      });
      if (starting) announce(chat);
      emit("run-delta", { chat, partial: state.runs.get(chat)?.partial ?? null });
    },
    /** The answer committed, as the backend reports it: the partial goes, the
     *  message it became is in the transcript — with the usage it was reported
     *  with, which is what keeps a settled answer's price on its own row — and
     *  the summary moves. */
    commit: (chat: number) => {
      const held = state.runs.get(chat);
      const partial = held?.partial;
      if (!held || !partial) return;
      state.runs.set(chat, {
        ...held,
        status: "idle",
        replies: held.replies + 1,
        messages: [
          ...held.messages,
          {
            role: "assistant",
            content: partial.answer,
            reasoning: partial.reasoning,
            waitMs: 900,
            thinkingMs: partial.thinkingMs ?? 0,
            ...(partial.usage ? { usage: partial.usage } : {}),
          },
        ],
        partial: null,
      });
      emit("run-delta", { chat, partial: null });
      announce(chat);
    },
    /** A turn that failed: the partial is dropped with nothing committed in its
     *  place, which takes a whole answer out of the thread at once. */
    fail: (chat: number, message = "the provider refused the request") => {
      const held = state.runs.get(chat);
      if (!held) return;
      state.runs.set(chat, { ...held, status: "failed", partial: null, error: message });
      emit("run-delta", { chat, partial: null });
      announce(chat);
    },
  };
}
const backend = installBackend();

function Harness() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<string | null>("An earlier prompt being rewritten");
  const [reasoning, setReasoning] = useState<ReasoningLevel>("");
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [jsonTab, setJsonTab] = useState<JsonTab>("history");
  const [events, setEvents] = useState<string[]>([]);
  // The feed's rows as the block below draws them, which is what lets a pin be
  // pressed here: the row it is pressed on is the row that changes.
  const [feed, setFeed] = useState<ChannelRow[]>(FEED);
  // Which of the sidebar's two rows is the one showing, so the column and the
  // list it opens can both be looked at.
  const [pinsOpen, setPinsOpen] = useState(false);
  const [config, setConfig] = useState<AppConfig>(() => ({ ...APP_CONFIG }));

  Object.assign(window, { events: () => events });
  Object.assign(window, { setEditing });

  const assistant: UiMessage = {
    role: "assistant",
    content: "The answer.",
    reasoning: "I thought about it for a while.",
    waitMs: 400,
    thinkingMs: 3200,
    usage: {
      prompt_tokens: 1204,
      completion_tokens: 356,
      total_tokens: 1560,
      cost: 0.0021,
    },
  };

  return (
    // The window's own box, with the watcher's one change: the app clips its
    // overflow because a window does not scroll, and a scratch page whose blocks
    // are taller than the viewport has to.
    <div className="app" style={{ overflowY: "auto" }}>
      <div className="shell">
                <main className="main">
          <ChatNav
            thread
            onBack={() => setEvents((e) => [...e, "back"])}
            jsonView={false}
            onJsonView={() => {}}
          />
          <div className="messages" style={{ padding: 24 }}>
            <ChatMessage
              message={assistant}
              index={0}
              author="valerii"
              head
              thought={{
                text: assistant.reasoning ?? "",
                waitMs: assistant.waitMs ?? 0,
                thinkingMs: assistant.thinkingMs ?? 0,
              }}
              canAct
              onRegenerate={() => {}}
              onEdit={() => {}}
            />
          </div>
          {/* The transcript is a scrolling pane, and a page that stacks its
              surfaces gives it no height of its own: without one it is a sliver
              and there is nothing to look at. */}
          <div style={{ display: "flex", height: 520 }}>
            <MessageList
              messages={TOOL_TURN}
              author="valerii"
              pending={null}
              error=""
              // Not following, so the turn is read from its start rather than
              // from its end: the whole of it is what is worth looking at here.
              follow={false}
              onFollowChange={() => {}}
              // The rows a message offers under it are part of what is worth
              // looking at here, so they are offered.
              canAct
              onRegenerate={() => {}}
              onEdit={() => {}}
            />
          </div>
          <ScrollHarness />
          {/* The feed's own rows, one of them pinned and one of them being
              answered: the row's menu has two readings and the pinned block is a
              state of the row, so both are drawn here where they can be driven. */}
          <div className="channel-list" style={{ width: 720, padding: 12 }}>
            {feed.map((row) => (
              <ChannelRowItem
                key={row.chat}
                row={row}
                author="valerii"
                onOpen={(chat) => setEvents((e) => [...e, `open ${chat}`])}
                onDelete={(chat) => setEvents((e) => [...e, `delete ${chat}`])}
                onPin={(chat, pinned) => {
                  setEvents((e) => [...e, `${pinned ? "pin" : "unpin"} ${chat}`]);
                  setFeed((rows) =>
                    rows.map((row) =>
                      row.chat === chat ? { ...row, pinnedAt: pinned ? Date.now() : 0 } : row,
                    ),
                  );
                }}
              />
            ))}
          </div>
          {/* The window's own column, and the list one of its rows opens: the
              components the app draws, with fixtures standing in for the
              backend, so the two can be looked at and driven here. */}
          <div style={{ display: "flex", flex: "none", height: 340, minHeight: 0 }}>
            <Sidebar
              view={pinsOpen ? "pins" : "channel"}
              onChannel={() => setPinsOpen(false)}
              onPins={() => setPinsOpen(true)}
              onSettings={() => setEvents((e) => [...e, "settings"])}
            />
            <main className="main">
              <div className="pins-scroll">
                <PinsView
                  rows={PIN_ROWS}
                  author="valerii"
                  onOpen={(chat) => setEvents((e) => [...e, `open pin ${chat}`])}
                  onDelete={(chat) => setEvents((e) => [...e, `delete ${chat}`])}
                  onPin={(chat, pinned) => setEvents((e) => [...e, `${pinned ? "pin" : "unpin"} ${chat}`])}
                />
              </div>
            </main>
          </div>
          {/* And with nothing pinned: what the list says before there is any. */}
          <div style={{ display: "flex", flex: "none", height: 220, minHeight: 0 }}>
            <main className="main">
              <div className="pins-scroll">
                <PinsView rows={[]} author="valerii" onOpen={() => {}} onDelete={() => {}} onPin={() => {}} />
              </div>
            </main>
          </div>
          {/* The plain-JSON view, in the pane the window puts it in: the mode's
              own strip — its name at the left, the way out at the right —
              over the sections and the view itself, which is the one bar the
              settings wear too. */}
          <div className="pane-stack" style={{ flex: "none", height: 420 }}>
            <div className="pane">
              <ChatNav
                thread={false}
                onBack={() => {}}
                jsonView
                onJsonView={() => {}}
                title="JSON"
                onClose={() => setEvents((e) => [...e, "close json"])}
              />
              <div className="settings-body">
                <SectionNav
                  label="JSON sections"
                  sections={JSON_SECTIONS}
                  active={jsonTab}
                  onSelect={(id) => setJsonTab(id as JsonTab)}
                />
                <JsonView tab={jsonTab} chat={1} costs={COSTS} />
              </div>
            </div>
          </div>
          {/* And the other tab: every tool, grouped by its server, which is what
              the sections' Tools tab puts in the pane. */}
          <div style={{ display: "flex", flex: "none", height: 320, minHeight: 0 }}>
            <JsonView tab="tools" chat={1} costs={COSTS} />
          </div>
          {/* The settings as the window draws them — the pane's own strip with
              the mode and its way out on it, then the sections and the page —
              with a stand-in for the write: the page saves itself here exactly
              as it does in the window, on the reader stopping, on the window
              losing the focus, and on the way out, and the events below are that
              write. It is the window's own shape, the pane and its bar included,
              since a page looked at in a box of its own could hide a fault the
              pane would show. `?tab=` names the section a reader lands on, since
              a page that has to be driven to is one that cannot be looked at
              from the outside. */}
          <div className="pane-stack" style={{ flex: "none", height: 560 }}>
            <div className="pane">
              <ChatNav
                thread={false}
                onBack={() => {}}
                jsonView={false}
                onJsonView={() => {}}
                title="Settings"
                onClose={() => setEvents((e) => [...e, "leave settings"])}
              />
              <SettingsView
                config={config}
                initialTab={SETTINGS_TAB}
                save={async (next) => {
                  await new Promise((resolve) => setTimeout(resolve, 120));
                  setEvents((e) => [...e, `write ${next.models.length} models`]);
                  return next;
                }}
                onSaved={setConfig}
                onOpenLogs={() => setEvents((e) => [...e, "logs"])}
              />
            </div>
          </div>
          {/* The card a turn stops at when a server is not marked to run its
              calls without asking: the one surface with two answers, and the
              only place the app says a call is waiting. */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              padding: "0 24px 24px",
            }}
          >
            <ToolApproval
              calls={[
                { id: "1", name: "ledger__run_query", arguments: '{"query":"SELECT * FROM accounts"}' },
                { id: "2", name: "ledger__balance", arguments: "{}" },
              ]}
              onRun={() => setEvents((e) => [...e, "run"])}
              onDecline={() => setEvents((e) => [...e, "decline"])}
            />
          </div>
          <footer className="composer-bar">
            <Composer
              textareaRef={textareaRef}
              streaming={false}
              model={settingsModel(config)}
              models={config.models}
              onModel={(name) => setEvents((e) => [...e, `model ${name}`])}
              cost={{ total: 0.042, latest: 0.011 }}
              reasoning={reasoning}
              onReasoning={(level) => {
                setReasoning(level);
                setEvents((e) => [...e, `reasoning ${level || "off"}`]);
              }}
              editingText={editing}
              onCancelEdit={() => {
                setEditing(null);
                setEvents((e) => [...e, "cancel-edit"]);
              }}
              servers={{
                declared: SERVERS,
                tools: TOOLS,
                failures: FAILURES,
                costs: COSTS,
                reading: false,
                chosen,
                loaded: LOADED,
                onChoose: setChosen,
                onRefresh: () => setEvents((e) => [...e, "refresh-tools"]),
              }}
              onSubmit={() => {}}
              onStop={() => {}}
            />
          </footer>
        </main>
      </div>
    </div>
  );
}

/**
 * A transcript the driver can push content into, the way a stream pushes it, so
 * the follow logic can be watched: `grow` appends a chunk to the last answer,
 * `state` reports where the view is and whether it is attached.
 */
function ScrollHarness() {
  const [messages, setMessages] = useState<UiMessage[]>([
    { role: "user", content: "First prompt", sentAt: Date.now() - 90_000 },
    { role: "assistant", content: "An answer.", waitMs: 1_400 },
  ]);
  const [pending, setPending] = useState<Partial | null>(null);
  const [follow, setFollow] = useState(true);
  /** The pending answer as of this render, for the settle driver. */
  const pendingLive = useRef(pending);
  pendingLive.current = pending;

  const started: Partial = {
    startedAt: Date.now(),
    firstTokenAt: null,
    reasoning: "",
    answer: "",
    thinking: true,
    thinkingMs: null,
    usage: null,
  };

  // The driver, reachable from a tool that drives the page from outside the
  // page's own world — a script runner sees the same DOM and nothing of these
  // globals — so it is asked through an event, and answers in the same event.
  useEffect(() => {
    function call(event: Event) {
      const { fn, args } = (event as CustomEvent<{ fn: string; args: unknown[] }>).detail ?? {
        fn: "",
        args: [],
      };
      const asked = (window as unknown as Record<string, (...a: unknown[]) => unknown>)[fn];
      const result = asked ? asked(...args) : null;
      document.body.dataset.harness = JSON.stringify({ fn, result });
    }
    window.addEventListener("harness-call", call);
    return () => window.removeEventListener("harness-call", call);
  }, []);

  Object.assign(window, {
    grow: (words = 40) =>
      setMessages((all) => {
        const last = all[all.length - 1];
        const content = `${last.content} ${"word ".repeat(words)}`;
        return [...all.slice(0, -1), { ...last, content }];
      }),
    /** Streams the way a response arrives: one growing pending answer. */
    stream: (words = 40) =>
      setPending((p) => ({ ...(p ?? started), answer: `${(p ?? started).answer} ${"word ".repeat(words)}` })),
    /** A new message while nothing is arriving. */
    append: (text = "A new message.") =>
      setMessages((all) => [...all, { role: "assistant", content: text }]),
    /** A prompt: a new message and a stream starting with it, as a send does. */
    send: (text = "A new prompt.") => {
      setMessages((all) => [...all, { role: "user", content: text }]);
      setPending(started);
    },
    /** The answer that was arriving lands as a message, as a stream's end does.
     *  The window draws it in one render: the transcript it reads has the answer
     *  as a message and the partial in the same snapshot, and the window holds the
     *  bubble until that read, so what is delivered here is both at once. */
    settle: () => {
      const answer = pendingLive.current?.answer || "An answer.";
      setPending(null);
      setMessages((all) => [...all, { role: "assistant", content: answer }]);
    },
    /** What a send does: the app asks for the view by setting follow. */
    followNow: (state = true) => setFollow(state),
    scrollState: () => {
      const el = document.querySelector("#scroll-harness .messages") as HTMLElement;
      const bubble = el.lastElementChild?.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return {
        follow,
        arrow: !!document.querySelector("#scroll-harness .to-bottom"),
        atBottom: el.scrollHeight - el.scrollTop - el.clientHeight <= 16,
        top: Math.round(el.scrollTop),
        max: Math.round(el.scrollHeight - el.clientHeight),
        gapBelowContent: bubble ? Math.round(box.bottom - bubble.bottom) : null,
      };
    },
  });

  return (
    <div
      id="scroll-harness"
      style={{ display: "flex", flexDirection: "column", flex: "none", height: 420, minHeight: 0 }}
    >
      <MessageList
        messages={messages}
        author="valerii"
        pending={pending}
        error=""
        follow={follow}
        onFollowChange={setFollow}
        canAct
        onRegenerate={() => {}}
        onEdit={() => {}}
      />
    </div>
  );
}

// The scratch page wears the scheme the app is set to, as the app's own window
// does, so a surface looked at here is looked at in the scheme it is worn in.
installTheme();

// `?app` is the window itself rather than a surface of it: the real `App`, with
// the backend above standing in for Rust, so what the window does about a view, a
// run or a report from a run can be driven end to end — the store, the panes and
// the transcript that reads them. The driver reaches the backend through
// `window.backend`; without the parameter this is the scratch page it always was.
const asApp = new URLSearchParams(location.search).has("app");
Object.assign(window, { backend });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  asApp ? <App /> : <Harness />,
);
