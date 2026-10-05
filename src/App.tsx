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
import "./App.css";

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
  const threadOpen = view.kind === "thread";

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
        {/* The rail carries what belongs to no single view: the way back to the
            feed while a thread is open, and the settings, which both views reach. */}
        <TitleBar
          thread={threadOpen}
          onBack={conversation.backToChannel}
          onOpenSettings={conversation.toggleSettings}
        />

        <main className="main">
          {/* The panel's own nav: the model, and the window's view switches while
              a thread is open. It is not drawn while the settings take the pane. */}
          {!conversation.settingsView && (
            <ChatNav
              model={conversation.model}
              models={config?.models ?? []}
              onPick={conversation.setModel}
              thread={threadOpen}
              jsonView={conversation.jsonView}
              onJsonView={conversation.showJson}
            />
          )}

          {/* Settings and the JSON view take the pane, one at a time, and both
              are the same shape: a bar naming the mode and holding the way out,
              then a vertical list of sections down the left and the pane they
              open on the right. */}
          {conversation.settingsView ? (
            <>
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
            </>
          ) : view.kind === "channel" ? (
            /* The feed of threads. The composer is the window's own — its submit
               is a post, which makes a thread and answers in the background. */
            <Channel
              rows={conversation.rows}
              error={error}
              onOpen={conversation.openThread}
              onDelete={conversation.deleteChat}
              composer={
                <Composer
                  textareaRef={composerRef}
                  streaming={false}
                  reasoning={conversation.reasoning}
                  onReasoning={conversation.setReasoning}
                  spent={0}
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
          ) : conversation.jsonView ? (
            <>
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
            </>
          ) : (
            <ChatPane
              messages={conversation.messages}
              pending={conversation.pending}
              error={error || conversation.threadError || conversation.unreachable}
              follow={follow}
              onFollowChange={setFollow}
              canAct={conversation.canAct}
              onRegenerate={conversation.regenerate}
              onEdit={conversation.startEdit}
              awaiting={conversation.awaiting.length > 0 ? conversation.awaiting : null}
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
