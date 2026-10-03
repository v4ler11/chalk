import { useState } from "react";
import { Settings } from "lucide-react";
import { MOD } from "../keybinds";
import { ChatWave, waveSeed } from "./ChatWave";
import { RowDelete, useDeleteQuestion } from "./RowDelete";
import type { ChatSummary } from "../types";

/**
 * Which group of the history a chat belongs in, from when it was last written.
 * Calendar days, not elapsed hours: a chat written at half past midnight is
 * today's, not yesterday's. The labels are the ones the design draws.
 */
function groupOf(updatedAt: number): string {
  const midnight = (ms: number) => {
    const day = new Date(ms);
    day.setHours(0, 0, 0, 0);
    return day.getTime();
  };
  const days = Math.round((midnight(Date.now()) - midnight(updatedAt)) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return "This Week";
  return "Earlier";
}

/**
 * The chats in their groups, in the order the store gave them — most recently
 * written first, so equal labels arrive together and a run per label is enough.
 */
function grouped(chats: ChatSummary[]): [string, ChatSummary[]][] {
  const groups: [string, ChatSummary[]][] = [];
  for (const chat of chats) {
    const label = groupOf(chat.updatedAt);
    const last = groups[groups.length - 1];
    if (last && last[0] === label) last[1].push(chat);
    else groups.push([label, [chat]]);
  }
  return groups;
}

interface Props {
  /** Open state: the panel slides in and out of the window's left edge. */
  open: boolean;
  /** The history, most recently written first. */
  chats: ChatSummary[];
  /** The open chat's row, while it has one: a draft is listed under nothing. */
  openId: number | null;
  /** Opens a chat. */
  onOpen: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
  /** Opens the settings window. */
  onOpenSettings: () => void;
}

/**
 * One row of the history: the wave that marks it as a conversation, the title
 * that opens it on a click and renames it on a double click, and the button that
 * deletes it. That button holds its place whether or not it is drawn, so a row
 * never twitches under the pointer, and deleting asks first — the row becomes
 * the question.
 */
function ChatRow({
  chat,
  active,
  onOpen,
  onRename,
  onDelete,
}: {
  chat: ChatSummary;
  active: boolean;
  onOpen: (id: number) => void;
  onRename: (id: number, title: string) => void;
  onDelete: (id: number) => void;
}) {
  const [mode, setMode] = useState<"open" | "rename">("open");
  const [draft, setDraft] = useState(chat.title);
  // Deleting a row is one question, shared with every other list that has rows
  // worth removing, so this row only says which shape it is in: its own, or the
  // question about to remove it.
  const { asking, ask, giveUp } = useDeleteQuestion();
  // A row being removed wears the open chat's treatment, so the question reads
  // as the row's own and not as a stray line in the list.
  const lit = active || asking;

  function rename() {
    setMode("open");
    const title = draft.trim();
    if (title === "" || title === chat.title) {
      setDraft(chat.title);
      return;
    }
    onRename(chat.id, title);
  }

  if (mode === "rename") {
    return (
      <div className="chat-item active">
        <ChatWave seed={waveSeed(chat.title)} strokeWidth={1.5} />
        <input
          className="chat-item-input"
          autoFocus
          value={draft}
          aria-label="Chat name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={rename}
          onKeyDown={(e) => {
            if (e.key === "Enter") rename();
            if (e.key === "Escape") {
              setDraft(chat.title);
              setMode("open");
            }
          }}
        />
      </div>
    );
  }

  return (
    <div className={`chat-item row${lit ? " active" : ""}${asking ? " confirming" : ""}`}>
      <ChatWave seed={waveSeed(chat.title)} strokeWidth={lit ? 1.5 : 1.25} />
      {/* While the question is up the row keeps its wave and its place, and what
          there is to read is the question rather than the chat's name. */}
      {asking ? (
        <span className="chat-item-title">
          <span className="chat-item-name">Delete this chat?</span>
        </span>
      ) : (
        <button
          className="chat-item-title"
          onClick={() => onOpen(chat.id)}
          onDoubleClick={() => setMode("rename")}
        >
          <span className="chat-item-name">{chat.title}</span>
        </button>
      )}
      <RowDelete
        asking={asking}
        label={`Delete "${chat.title}"`}
        ask={ask}
        giveUp={giveUp}
        onDelete={() => onDelete(chat.id)}
      />
    </div>
  );
}

export function Sidebar({
  open,
  chats,
  openId,
  onOpen,
  onRename,
  onDelete,
  onOpenSettings,
}: Props) {
  return (
    // Stays mounted while closed so it can slide; `inert` keeps its rows out of
    // the tab order and out of the accessibility tree once it is off-screen.
    <aside className={`sidebar${open ? " open" : ""}`} inert={!open}>
      <div className="sidebar-scroll">
        {grouped(chats).map(([label, rows]) => (
          <div className="nav-section" key={label}>
            <span className="nav-label">{label}</span>
            <div className="nav-list">
              {rows.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  active={chat.id === openId}
                  onOpen={onOpen}
                  onRename={onRename}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="sidebar-foot">
        <button className="sidebar-settings" onClick={onOpenSettings}>
          <Settings size={15} />
          <span>Settings</span>
          <kbd>{MOD},</kbd>
        </button>
      </div>
    </aside>
  );
}
