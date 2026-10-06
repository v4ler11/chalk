// A scratch page for the window's surfaces — the composer's controls and their
// menus, the history's rows, the settings sections — so one can be looked at, and
// driven, without the desktop window. Not part of the app: `harness.html` is the
// only thing that loads it.
import ReactDOM from "react-dom/client";
import { useEffect, useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { ChannelRowItem } from "./components/ChannelRow";
import { ChatMessage } from "./components/ChatMessage";
import { ChatNav } from "./components/ChatNav";
import { JsonView } from "./components/JsonView";
import { MessageList } from "./components/MessageList";
import { ModeBar } from "./components/ModeBar";
import { PinsView } from "./components/PinsView";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import type { ChannelRow } from "./feed";
import type {
  AppConfig,
  ChatSummary,
  McpCost,
  McpFailure,
  McpServer,
  McpTool,
  Partial,
  ReasoningLevel,
  UiMessage,
} from "./types";
import "katex/dist/katex.min.css";
import "./App.css";
// The feed's own sheet is imported by the component that draws it, so a page that
// draws a feed row without the channel has to ask for it the same way.
import "./styles/channel.css";

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
      "**Assets**\n\n- Cash: `Assets:Cash:EUR`\n- Mono (UA): `Assets:Mono:EUR`, `Assets:Mono:UAH`",
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

function Harness() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<string | null>("An earlier prompt being rewritten");
  const [reasoning, setReasoning] = useState<ReasoningLevel>("");
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  // The feed's rows as the block below draws them, which is what lets a pin be
  // pressed here: the row it is pressed on is the row that changes.
  const [feed, setFeed] = useState<ChannelRow[]>(FEED);
  // Which of the sidebar's two rows is the one showing, so the column and the
  // list it opens can both be looked at.
  const [pinsOpen, setPinsOpen] = useState(false);
  const [config, setConfig] = useState<AppConfig>({
    name: "Valerii",
    provider: "openrouter",
    endpoint: "",
    apiKey: "sk-or-v1-abcdefghijklmnop",
    models: ["deepseek/deepseek-v4.1-flash"],
    systemPrompt: "Answer in one line.",
  });

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
            onOpenSettings={() => setEvents((e) => [...e, "settings"])}
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
              pinsOpen={pinsOpen}
              onChannel={() => setPinsOpen(false)}
              onPins={() => setPinsOpen(true)}
            />
            <main className="main">
              <ModeBar title="Pins" onClose={() => setPinsOpen(false)} />
              <div className="pins-scroll">
                <PinsView
                  pins={PINS}
                  author="valerii"
                  onOpen={(pin) => setEvents((e) => [...e, `open pin ${pin.id}`])}
                />
              </div>
            </main>
          </div>
          {/* And with nothing pinned: what the list says before there is any. */}
          <div style={{ display: "flex", flex: "none", height: 220, minHeight: 0 }}>
            <main className="main">
              <ModeBar title="Pins" onClose={() => {}} />
              <div className="pins-scroll">
                <PinsView pins={[]} author="valerii" onOpen={() => {}} />
              </div>
            </main>
          </div>
          {/* The plain-JSON view over the same turn: the system prompt in front,
              then every message with its calls, results and timings. */}
          <div style={{ display: "flex", flex: "none", height: 360, minHeight: 0 }}>
            <JsonView tab="history" chat={1} costs={COSTS} />
          </div>
          {/* And the other tab: every tool, grouped by its server, which is what
              the navbar's Tools tab puts in the pane. */}
          <div style={{ display: "flex", flex: "none", height: 320, minHeight: 0 }}>
            <JsonView tab="tools" chat={1} costs={COSTS} />
          </div>
          <div className="settings-body" style={{ flex: "none", height: 420 }}>
            <SettingsPanel
              config={config}
              onChange={(patch) => setConfig((c) => ({ ...c, ...patch }))}
              onSave={() => setEvents((e) => [...e, "save"])}
              onOpenLogs={() => setEvents((e) => [...e, "logs"])}
            />
          </div>
          <footer className="composer-bar">
            <Composer
              textareaRef={textareaRef}
              streaming={false}
              model={config.models[0] ?? ""}
              models={config.models}
              onModel={(name) => setEvents((e) => [...e, `model ${name}`])}
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
    /** The answer that was arriving lands as a message, as a stream's end does. */
    settle: () => {
      const answer = pendingLive.current?.answer || "An answer.";
      setMessages((all) => [...all, { role: "assistant", content: answer }]);
      setPending(null);
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

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<Harness />);
