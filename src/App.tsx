import { useCallback, useEffect, useRef, useState } from "react";
import { mod } from "./keybinds";
import { useConfig } from "./useConfig";
import { useServers } from "./useServers";
import { useConversation } from "./useConversation";
import { Channel } from "./components/Channel";
import { ChatNav } from "./components/ChatNav";
import { ChatPane } from "./components/ChatPane";
import { Composer } from "./components/Composer";
import { JsonView, JSON_SECTIONS, type JsonTab } from "./components/JsonView";
import { SectionNav } from "./components/SectionNav";
import { ModeBar } from "./components/ModeBar";
import { SettingsView } from "./components/SettingsView";
import { TitleBar } from "./components/TitleBar";
import type { Partial, UiMessage } from "./types";
import "./App.css";

/** How long the thread's pane takes to slide in and out, matching `thread-in`. */
const LEAVE_MS = 180;

/**
 * The window: the rail at the top-left, and the pane beneath it — the channel's
 * feed, or one thread's transcript, or a mode standing in for either. What the
 * window *is* — the view, the runs, the modes — is in `useConversation`; this is
 * what it looks like.
 */
function App() {
  // Whether the transcript follows new content. Stays on unless the reader
  // scrolls up, and comes back when they reach the bottom, send, or press ↓.
  const [follow, setFollow] = useState(true);
  // What the window has to say about the last thing that failed.
  const [error, setError] = useState("");
  const fail = useCallback((e: unknown) => setError(String(e)), []);

  // The composer's field. The channel and a thread each draw their own composer,
  // but only one is ever mounted, so the caret can be handed to whichever is.
  const composerRef = useRef<HTMLTextAreaElement>(null);

  const { config, setConfig } = useConfig(fail);
  const { servers, tools, failures, costs, reading, readTools } = useServers(fail);
  const conversation = useConversation({ config, servers, failures, setError, setFollow, composerRef });

  const view = conversation.view;
  // The models Settings offers, in their order, read here once: both composers
  // name the one in use and open this list.
  const models = config?.models ?? [];
  const threadOpen = view.kind === "thread";
  // The feed stays mounted while a thread or the settings are showing, hidden
  // rather than unmounted, so its scroll and its half-typed draft survive the
  // trip. `visibility`, not `display: none`, is what keeps its scroll position.
  const channelVisible = !conversation.settingsView && view.kind === "channel";
  // The thread's pane is the one that slides, and it is the visible pane whenever
  // a thread is the view and neither the JSON view nor the settings has the
  // panel.
  const threadVisible = threadOpen && !conversation.settingsView && !conversation.jsonView;
  // Both composers are mounted at once, and the shared ref must land on the one
  // on screen: the channel's takes this spare while it is hidden.
  const channelComposerRef = useRef<HTMLTextAreaElement>(null);

  // The thread's pane leaves by sliding, so it is held for the length of the
  // slide, showing what it had. The view is the channel by then and the
  // transcript is empty, and a blank sheet sliding away is not the chat leaving.
  const held = useRef<{ messages: UiMessage[]; pending: Partial | null }>({
    messages: [],
    pending: null,
  });
  const [leaving, setLeaving] = useState(false);
  const wasThread = useRef(false);

  // What the pane last had, kept while the thread is the view.
  useEffect(() => {
    if (!threadOpen) return;
    wasThread.current = true;
    held.current = { messages: conversation.messages, pending: conversation.pending };
  }, [threadOpen, conversation.messages, conversation.pending]);

  // Back on the channel: one slide, then the pane is put away.
  useEffect(() => {
    if (threadOpen || !wasThread.current) return;
    wasThread.current = false;
    setLeaving(true);
    const done = window.setTimeout(() => setLeaving(false), LEAVE_MS);
    return () => window.clearTimeout(done);
  }, [threadOpen]);

  // The window's shortcuts, beside the buttons that do the same thing. Escape is
  // the taken-over pane's own: it leaves the settings or the JSON view first,
  // and otherwise returns to the channel. ⌘J is the JSON view, and ⌘, the
  // settings — the command the platform puts on that key.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // A control that has already taken the key — the composer's Escape giving
      // up an edit — keeps it: the window's own reading of it must not fire on
      // top of that.
      if (event.defaultPrevented) return;
      if (event.key === "Escape") {
        if (conversation.settingsView) {
          event.preventDefault();
          conversation.leaveSettings();
        } else if (conversation.jsonView) {
          event.preventDefault();
          conversation.closeJson();
        } else if (threadOpen) {
          event.preventDefault();
          conversation.backToChannel();
        }
        return;
      }
      if (!mod(event) || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "j" && threadOpen) {
        // The JSON view belongs to a thread: a channel has no request to show.
        event.preventDefault();
        conversation.showJson(!conversation.jsonView);
      } else if (key === ",") {
        event.preventDefault();
        conversation.toggleSettings();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    conversation.settingsView,
    conversation.jsonView,
    conversation.leaveSettings,
    conversation.closeJson,
    conversation.showJson,
    conversation.toggleSettings,
    conversation.backToChannel,
    threadOpen,
  ]);

  return (
    <div className="app">
      <div className="shell">
        {/* The rail carries the way back to the feed while a thread is open.
            The settings are the panel's own now, behind its three-dots. */}
        <TitleBar thread={threadOpen} onBack={conversation.backToChannel} />

        <main className="main">
          {/* The panel's own nav: the model, and the window's view switches while
              a thread is open. It is not drawn while the settings take the pane. */}
          {!conversation.settingsView && (
            <ChatNav
              thread={threadOpen}
              jsonView={conversation.jsonView}
              onJsonView={conversation.showJson}
              onOpenSettings={conversation.toggleSettings}
            />
          )}

          {/* The panes share one box so the feed can stay mounted under a thread
              or the settings: opening one and coming back must not rebuild the
              channel. The hidden pane keeps its place and its scroll. */}
          <div className="pane-stack">
            <div className={`pane${channelVisible ? "" : " off"}`} inert={!channelVisible}>
              <Channel
                rows={conversation.rows}
                error={error}
                onOpen={conversation.openThread}
                onDelete={conversation.deleteChat}
                composer={
                  <Composer
                    textareaRef={channelVisible ? composerRef : channelComposerRef}
                    streaming={false}
                    model={conversation.model}
                    models={models}
                    onModel={conversation.setModel}
                    reasoning={conversation.reasoning}
                    onReasoning={conversation.setReasoning}
                    editingText={null}
                    onCancelEdit={() => {}}
                    servers={{
                      declared: servers,
                      tools,
                      failures,
                      costs,
                      reading,
                      chosen: conversation.chosen,
                      loaded: conversation.loaded,
                      onChoose: conversation.setChosen,
                      onRefresh: () => readTools(true),
                    }}
                    onSubmit={conversation.post}
                    onStop={() => {}}
                  />
                }
              />
            </div>

            {/* Settings and the JSON view take the pane, one at a time, and both
                are the same shape: a bar naming the mode and holding the way out,
                then a vertical list of sections down the left and the pane they
                open on the right. */}
            {conversation.settingsView ? (
              <div className="pane">
                <ModeBar title="Settings" onClose={conversation.leaveSettings} />
                {config ? (
                  <SettingsView config={config} onSaved={setConfig} />
                ) : (
                  <div className="settings-body">
                    <p className="json-note" style={{ padding: 24 }}>
                      Reading the settings…
                    </p>
                  </div>
                )}
              </div>
            ) : view.kind === "thread" && conversation.jsonView ? (
              <div className="pane">
                <ModeBar title="JSON" onClose={conversation.closeJson} />
                <div className="settings-body">
                  <SectionNav
                    label="JSON sections"
                    sections={JSON_SECTIONS}
                    active={conversation.jsonTab}
                    onSelect={(id) => conversation.setJsonTab(id as JsonTab)}
                  />
                  <JsonView tab={conversation.jsonTab} chat={view.chat} costs={costs} />
                </div>
              </div>
            ) : threadOpen || leaving ? (
              <div className={`pane thread${threadVisible ? "" : " off"}`}>
                <ChatPane
                  messages={threadVisible ? conversation.messages : held.current.messages}
                  pending={threadVisible ? conversation.pending : held.current.pending}
                  error={error || conversation.threadError || conversation.unreachable}
                  follow={follow}
                  onFollowChange={setFollow}
                  canAct={conversation.canAct}
                  onRegenerate={conversation.regenerate}
                  onEdit={conversation.startEdit}
                  awaiting={conversation.awaiting.length > 0 ? conversation.awaiting : null}
                  onRun={conversation.allow}
                  onDecline={conversation.decline}
                  composerRef={threadVisible ? composerRef : channelComposerRef}
                  model={conversation.model}
                  models={models}
                  onModel={conversation.setModel}
                  reasoning={conversation.reasoning}
                  onReasoning={conversation.setReasoning}
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
              </div>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
