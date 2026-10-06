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
import { PinsView } from "./components/PinsView";
import { SettingsView } from "./components/SettingsView";
import { Sidebar } from "./components/Sidebar";
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
  const channelVisible =
    !conversation.settingsView && !conversation.pinsView && view.kind === "channel";
  // The pane the sidebar's row chose is the one under everything else: the feed,
  // or the pins. A thread is drawn over it, and the settings or the JSON view over
  // that — so what the sidebar says stays true while a thread is open, which is
  // what makes coming back out of one land where the reader left from.
  const threadVisible = threadOpen && !conversation.settingsView && !conversation.jsonView;
  const pinsVisible =
    conversation.pinsView && !threadVisible && !conversation.settingsView;
  // Both composers are mounted at once, and the shared ref must land on the one
  // on screen: the channel's takes this spare while it is hidden.
  const channelComposerRef = useRef<HTMLTextAreaElement>(null);

  // The thread's pane outlives the view by one slide, and what it was showing
  // outlives the thread's own state with it: the exit needs a pane that is still
  // there and a transcript that has not been emptied, or the slide is a blank
  // sheet going away.
  const held = useRef<{ messages: UiMessage[]; pending: Partial | null }>({
    messages: [],
    pending: null,
  });

  // Leaving is decided while rendering the change rather than after it. A pane
  // dropped on the render that flips the view and put back on the next one would
  // never be seen to slide: it would leave the page and arrive again, playing the
  // arrival's own animation a second time.
  const [shownThread, setShownThread] = useState(threadOpen);
  const [holding, setHolding] = useState(false);
  if (shownThread !== threadOpen) {
    setShownThread(threadOpen);
    setHolding(!threadOpen);
  }
  const threadPane = threadOpen || holding;

  // What the pane last had, kept while the thread is the view.
  useEffect(() => {
    if (!threadOpen) return;
    held.current = { messages: conversation.messages, pending: conversation.pending };
  }, [threadOpen, conversation.messages, conversation.pending]);

  // One slide, then the pane is put away.
  useEffect(() => {
    if (!holding) return;
    const done = window.setTimeout(() => setHolding(false), LEAVE_MS);
    return () => window.clearTimeout(done);
  }, [holding]);

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

  // The panel's own bar, built for the pane it stands on: a thread's bar carries
  // the way back and the dots that offer the switches a thread has, and a
  // channel's carries neither, so nothing appears on one bar because of what
  // another pane is doing.
  const nav = (thread: boolean) => (
    <ChatNav
      thread={thread}
      onBack={conversation.backToChannel}
      jsonView={conversation.jsonView}
      onJsonView={conversation.showJson}
    />
  );

  return (
    <div className="app">
      <div className="shell">
        {/* The rail is the window's own corner now: the controls and the drag
            region, and nothing that belongs to a pane. */}
        <TitleBar />

        {/* What there is to look at, one row each: the channel the threads rest
            in and the pins gathered out of all of them, with the settings at the
            foot of the column. It is the window's own rather than any pane's, so
            it is the same in every view — and it is narrow, because a view is a
            word. */}
        <Sidebar
          view={
            conversation.settingsView ? "settings" : conversation.pinsView ? "pins" : "channel"
          }
          onChannel={conversation.showChannel}
          onPins={() => conversation.showPins(true)}
          onSettings={conversation.toggleSettings}
        />

        <main className="main">
          {/* The panes share one box so the feed can stay mounted under a thread
              or the settings: opening one and coming back must not rebuild the
              channel. The hidden pane keeps its place and its scroll. Each pane
              draws the panel's bar itself, at its own top edge. */}
          <div className="pane-stack">
            <div className={`pane${channelVisible ? "" : " off"}`} inert={!channelVisible}>
              {nav(false)}
              <Channel
                rows={conversation.rows}
                author={conversation.author}
                error={error}
                onOpen={conversation.openThread}
                onDelete={conversation.deleteChat}
                onPin={conversation.pin}
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

            {/* The pane the sidebar's other row chose: the pinned threads, in the
                channel's own rows. It takes the pane the way the channel does —
                the same strip at the top, then the list — since it is a tab and
                not a mode standing in for the chat: nothing here names it and
                nothing here is a way out of it, because the sidebar's row is
                both. It is drawn *under* a thread rather than over one — a thread
                opened from this list is a thread over the pins, and coming back
                out of it lands here — so it stays mounted while the thread is up,
                with its scroll where the reader left it. */}
            {conversation.pinsView ? (
              <div className={`pane${pinsVisible ? "" : " off"}`} inert={!pinsVisible}>
                {nav(false)}
                <div className="pins-scroll">
                  <PinsView
                    rows={conversation.pinRows}
                    author={conversation.author}
                    onOpen={conversation.openThread}
                    onDelete={conversation.deleteChat}
                    onPin={conversation.pin}
                  />
                </div>
              </div>
            ) : null}

            {/* The thread's pane stays in the page while a mode stands in front
                of it. The settings and the JSON view are panels over the chat
                rather than another view of it, so nothing about the chat moves
                when one opens or closes; it leaves the page only when the
                channel is the view, and that is the movement the slide is for.
                It is inert while a mode is in front, so a reader reaches the
                panel and not the transcript behind it. */}
            {threadPane && (
              <div className={`pane thread${holding ? " off" : ""}`} inert={!threadVisible}>
                <ChatPane
                  nav={nav(true)}
                  messages={threadVisible ? conversation.messages : held.current.messages}
                  author={conversation.author}
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
            )}

            {/* The settings take the pane the way the pins do — the pane's own
                strip, then the sections down the left and the page they open on
                the right — and, like the JSON view, they wear the bar that names
                the mode under that strip: the column's own row opens them, but a
                pane that has taken the window over also says so and holds the
                way out of itself. */}
            {conversation.settingsView ? (
              <div className="pane">
                {nav(threadOpen)}
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
            ) : threadOpen && conversation.jsonView ? (
              <div className="pane">
                {nav(threadOpen)}
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
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

export default App;
