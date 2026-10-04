import { useCallback, useEffect, useRef, useState } from "react";
import { mod } from "./keybinds";
import { useConfig } from "./useConfig";
import { useServers } from "./useServers";
import { useConversation } from "./useConversation";
import { ChatNav } from "./components/ChatNav";
import { ChatPane } from "./components/ChatPane";
import { JsonView, JSON_SECTIONS, type JsonTab } from "./components/JsonView";
import { SectionNav } from "./components/SectionNav";
import { ModeBar } from "./components/ModeBar";
import { SettingsView } from "./components/SettingsView";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import "./App.css";

/**
 * The window: the chrome down the left, the chat or a mode in the pane beside
 * it, and the shortcuts that reach both. What the window *is* — the config, the
 * servers, the conversation — is in the hooks; this is what it looks like.
 */
function App() {
  // Whether the sidebar is showing. It is the window's, like the modes below.
  const [sidebarOpen, setSidebarOpen] = useState(true);
  // Whether the transcript and composer are standing aside for the raw JSON of
  // the conversation. It is the window's rather than any chat's: entered from
  // the nav's own menu, and left on — showing whichever chat is opened under it
  // — until it is left.
  const [jsonView, setJsonView] = useState(false);
  // Which JSON the view shows while it is on: the open chat's conversation, or
  // the tools its request carries.
  const [jsonTab, setJsonTab] = useState<JsonTab>("history");
  // Whether the settings are standing in the chat's place. Like the JSON view,
  // it is the window's own mode rather than any chat's, and the two are
  // exclusive: opening one gives up the other.
  const [settingsView, setSettingsView] = useState(false);
  // Whether the transcript follows new content. Stays on unless the user scrolls
  // up, and comes back when they reach the bottom, send, or press the arrow.
  const [follow, setFollow] = useState(true);
  // What the window has to say about the last thing that failed.
  const [error, setError] = useState("");
  const fail = useCallback((e: unknown) => setError(String(e)), []);

  // The composer's field, so a new chat can hand the caret to it.
  const composerRef = useRef<HTMLTextAreaElement>(null);

  /** Leaves whatever took the pane over. The JSON view is not left: it is what
   *  a chat is shown as, so opening a chat under it shows that chat's JSON. */
  const leaveSettings = useCallback(() => setSettingsView(false), []);

  const { config, setConfig } = useConfig(fail);
  const { servers, tools, failures, costs, reading, readTools } = useServers(fail);
  const conversation = useConversation({
    config,
    servers,
    tools,
    failures,
    setError,
    setFollow,
    composerRef,
    onLeaveMode: leaveSettings,
  });

  /**
   * Opens the settings in the window, or puts them away again: the form takes
   * the chat's place, so the button that opened it is also the way back, and the
   * JSON view is given up when it comes — the two are modes of one pane.
   */
  const toggleSettings = useCallback(() => {
    setSettingsView((open) => !open);
    setJsonView(false);
  }, []);

  const showJson = useCallback((on: boolean) => {
    setJsonView(on);
    if (on) setSettingsView(false);
  }, []);

  // The window's shortcuts, beside the buttons that do the same thing: the rail
  // offers two of these and the model chip the third, and there is no menu bar
  // to carry any of them.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Escape is the taken-over pane's own, and needs no chord: it does what
      // the bar's ESC button does — the settings if they are up, the JSON view
      // otherwise — whether or not a modifier is down.
      if (event.key === "Escape" && (settingsView || jsonView)) {
        event.preventDefault();
        setSettingsView(false);
        setJsonView(false);
        return;
      }
      if (!mod(event) || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "b") {
        event.preventDefault();
        setSidebarOpen((open) => !open);
      } else if (key === "n") {
        event.preventDefault();
        conversation.newChat();
      } else if (key === "j") {
        // The JSON view, the way the three-dots toggles it: the settings are
        // given up as it comes, since the two are modes of one pane.
        event.preventDefault();
        setSettingsView(false);
        setJsonView((on) => !on);
      } else if (key === ",") {
        // The command the platform puts on this key, which is where anyone
        // looking for the settings will press.
        event.preventDefault();
        toggleSettings();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [conversation.newChat, toggleSettings, jsonView, settingsView]);

  return (
    <div className="app">
      <div className="shell">
        {/* The window's chrome floats over whatever is beneath it: the sidebar's
            head while the sidebar is open, the chat panel's own top-left corner
            while it is shut, so the panel keeps the whole window then. */}
        <TitleBar
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen((open) => !open)}
          onNewChat={conversation.newChat}
        />

        {/* The sidebar is the window's history either way: a chat opened from
            it while the JSON view is on shows its JSON, so the list is left
            where it always is. */}
        <div className={`left${sidebarOpen ? " open" : ""}`}>
          <Sidebar
            open={sidebarOpen}
            chats={conversation.chats}
            openId={conversation.chatId}
            onOpen={conversation.openChat}
            onRename={conversation.renameChat}
            onDelete={conversation.deleteChat}
            onOpenSettings={toggleSettings}
          />
        </div>

        <main className="main">
          <ChatNav
            model={conversation.model}
            models={config?.models ?? []}
            onPick={conversation.setModel}
            jsonView={jsonView}
            onJsonView={showJson}
          />

          {/* Settings and the JSON view take the chat's place, one at a time,
              and both are the same shape: a bar under the chat panel's naming
              the mode and holding the way out, then a vertical list of sections
              down the left and the pane they open on the right. */}
          {settingsView ? (
            <>
              <ModeBar title="Settings" onClose={leaveSettings} />
              {config ? (
                <SettingsView config={config} onSaved={setConfig} />
              ) : (
                <div className="settings-body">
                  <p className="json-note" style={{ padding: 24 }}>
                    Reading the settings…
                  </p>
                </div>
              )}
            </>
          ) : jsonView ? (
            <>
              <ModeBar title="JSON" onClose={() => setJsonView(false)} />
              <div className="settings-body">
                <SectionNav
                  label="JSON sections"
                  sections={JSON_SECTIONS}
                  active={jsonTab}
                  onSelect={(id) => setJsonTab(id as JsonTab)}
                />
                <JsonView
                  tab={jsonTab}
                  messages={conversation.messages}
                  systemPrompt={config?.systemPrompt ?? ""}
                  tools={conversation.sentTools}
                  costs={costs}
                  lazy={conversation.lazyServers}
                />
              </div>
            </>
          ) : (
            <ChatPane
              messages={conversation.messages}
              pending={conversation.pending}
              error={error || conversation.unreachable}
              follow={follow}
              onFollowChange={setFollow}
              canAct={conversation.pending === null && config !== null}
              onRegenerate={conversation.regenerate}
              onEdit={conversation.startEdit}
              awaiting={conversation.awaiting}
              onRun={conversation.allow}
              onDecline={conversation.decline}
              composerRef={composerRef}
              reasoning={conversation.reasoning}
              onReasoning={conversation.setReasoning}
              spent={conversation.spent}
              editingText={conversation.editing?.text ?? null}
              onCancelEdit={() => conversation.setEditing(null)}
              servers={servers}
              tools={tools}
              failures={failures}
              costs={costs}
              reading={reading}
              chosen={conversation.chosen}
              loaded={conversation.loaded}
              onChoose={conversation.setChosen}
              onRefresh={() => readTools(true)}
              onSubmit={conversation.submit}
              onStop={conversation.stop}
            />
          )}
        </main>
      </div>
    </div>
  );
}

export default App;
