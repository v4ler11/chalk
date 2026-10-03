// A scratch page for the window's surfaces — the composer's controls and their
// menus, the history's rows, the settings sections — so one can be looked at, and
// driven, without the desktop window. Not part of the app: `harness.html` is the
// only thing that loads it.
import ReactDOM from "react-dom/client";
import { useRef, useState } from "react";
import { Composer } from "./components/Composer";
import { ChatMessage } from "./components/ChatMessage";
import { Sidebar } from "./components/Sidebar";
import { ChatNav } from "./components/ChatNav";
import { MessageList } from "./components/MessageList";
import { SettingsPanel } from "./components/SettingsPanel";
import type {
  AppConfig,
  ChatSummary,
  McpCost,
  McpFailure,
  McpServer,
  McpTool,
  Pending,
  ReasoningLevel,
  UiMessage,
} from "./types";
import "katex/dist/katex.min.css";
import "./App.css";

const CHATS: ChatSummary[] = [
  { id: 1, title: "First chat", updatedAt: Date.now(), model: "m", reasoning: "" },
  { id: 2, title: "Second chat", updatedAt: Date.now() - 10_000, model: "m", reasoning: "high" },
];

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
  { role: "user", content: "what did I spend on electricity?" },
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

function Harness() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState<string | null>("An earlier prompt being rewritten");
  const [reasoning, setReasoning] = useState<ReasoningLevel>("");
  const [chosen, setChosen] = useState<string[] | null>(null);
  const [events, setEvents] = useState<string[]>([]);
  const [config, setConfig] = useState<AppConfig>({
    provider: "openrouter",
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
    <div className="app">
      <div className="shell">
        <div className="left open">
          <Sidebar
            open
            chats={CHATS}
            openId={1}
            onOpen={(id) => setEvents((e) => [...e, `open ${id}`])}
            onRename={(id) => setEvents((e) => [...e, `rename ${id}`])}
            onDelete={(id) => setEvents((e) => [...e, `delete ${id}`])}
            onOpenSettings={() => setEvents((e) => [...e, "settings"])}
          />
        </div>
        <main className="main">
          <ChatNav model={config.models[0]} models={config.models} onPick={() => {}} />
          <div className="messages" style={{ padding: 24 }}>
            <ChatMessage
              message={assistant}
              index={0}
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
              reasoning={reasoning}
              spent={0.00428}
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
    { role: "user", content: "First prompt" },
    { role: "assistant", content: "An answer." },
  ]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [follow, setFollow] = useState(true);
  /** The pending answer as of this render, for the settle driver. */
  const pendingLive = useRef(pending);
  pendingLive.current = pending;

  const started: Pending = {
    startedAt: Date.now(),
    firstTokenAt: null,
    reasoning: "",
    answer: "",
    thinking: true,
    thinkingMs: null,
    usage: null,
    toolCalls: null,
  };

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
      const el = document.querySelector(".messages-wrap .messages") as HTMLElement;
      const bubble = el.lastElementChild?.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return {
        follow,
        arrow: !!document.querySelector(".messages-wrap .to-bottom"),
        atBottom: el.scrollHeight - el.scrollTop - el.clientHeight <= 16,
        top: Math.round(el.scrollTop),
        max: Math.round(el.scrollHeight - el.clientHeight),
        gapBelowContent: bubble ? Math.round(box.bottom - bubble.bottom) : null,
      };
    },
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", height: 420, minHeight: 0 }}>
      <MessageList
        messages={messages}
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
