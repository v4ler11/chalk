import { useRef, type ReactNode, type RefObject } from "react";
import type {
  McpCost,
  McpFailure,
  McpServer,
  McpTool,
  Partial,
  ReasoningLevel,
  ToolCallRequest,
  UiMessage,
} from "../types";
import { MessageList } from "./MessageList";
import { useComposerRoom } from "../useComposerRoom";
import { Composer } from "./Composer";
import { ToolApproval } from "./ToolApproval";

interface Props {
  /** The panel's own bar, drawn by the window so the pane can slide with it: it
   *  is a pane's top edge rather than the space above one. */
  nav: ReactNode;
  messages: UiMessage[];
  /** What the app calls the person whose prompts these are: the name and the
   *  mark the transcript heads them with. */
  author: string;
  pending: Partial | null;
  /** The chat's own error, or a server the chat calls that nobody can reach. */
  error: string;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  /** Whether a prompt's actions are offered; false while a response is arriving. */
  canAct: boolean;
  onRegenerate: (index: number) => void;
  onEdit: (index: number) => void;
  /** The calls a server asked to run, held above the composer until they are
   *  allowed or declined. */
  awaiting: ToolCallRequest[] | null;
  onRun: () => void;
  onDecline: () => void;
  composerRef: RefObject<HTMLTextAreaElement | null>;
  /** The model the open chat is holding, named in the composer's chip. */
  model: string;
  /** The models the settings offer, in their order. */
  models: string[];
  onModel: (model: string) => void;
  reasoning: ReasoningLevel;
  onReasoning: (level: ReasoningLevel) => void;
  editingText: string | null;
  onCancelEdit: () => void;
  servers: McpServer[];
  tools: McpTool[];
  failures: McpFailure[];
  costs: McpCost[];
  reading: boolean;
  chosen: string[] | null;
  loaded: string[];
  onChoose: (ids: string[] | null) => void;
  onRefresh: () => void;
  onSubmit: (text: string, images: string[]) => void;
  onStop: () => void;
}

/**
 * The chat itself: the transcript with the response arriving under it, the calls
 * waiting on the user above the composer, and the composer below them.
 *
 * It is one component because the three are one column — the transcript scrolls,
 * the composer is fixed under it, and the approval card stands between them —
 * and the window that owns the modes above it need not know their arrangement.
 */
export function ChatPane({
  nav,
  messages,
  author,
  pending,
  error,
  follow,
  onFollowChange,
  canAct,
  onRegenerate,
  onEdit,
  awaiting,
  onRun,
  onDecline,
  composerRef,
  model,
  models,
  onModel,
  reasoning,
  onReasoning,
  editingText,
  onCancelEdit,
  servers,
  tools,
  failures,
  costs,
  reading,
  chosen,
  loaded,
  onChoose,
  onRefresh,
  onSubmit,
  onStop,
}: Props) {
  const footer = useRef<HTMLElement>(null);
  // The composer floats over the transcript, and the transcript's foot keeps its
  // room: the typing that grows the composer does not move the transcript.
  useComposerRoom(footer);
  return (
    <>
      {/* What the thread is written on. The sheet covers the pane, the strip
          behind the composer included, and travels with the transcript; the
          composer's own card is drawn over it and does not move. */}
      <div className="transcript-sheet" aria-hidden="true" />
      {nav}
      <div className="transcript">
        <MessageList
          messages={messages}
          author={author}
          pending={pending}
          error={error}
          follow={follow}
          onFollowChange={onFollowChange}
          canAct={canAct}
          onRegenerate={onRegenerate}
          onEdit={onEdit}
        />
      </div>

      {/* The bar's own surface, over the strip the composer floats on. The bar
          cannot carry it: it clips what it holds, so a surface inside it would
          be wiped by that clip rather than travel out of its own box. This is
          the sheet's colour at the bar's own height — the measurement the pane
          already reserves for the bar — and one more thing in the slide, so the
          space under the composer moves with the thread while the composer's
          card stays where it is. */}
      <div className="composer-sheet" aria-hidden="true" />

      <footer className="composer-bar" ref={footer}>
        {/* A server's tool calls are what a turn may stop on: the calls are
            shown above the composer until the user allows them or says no. */}
        {awaiting && <ToolApproval calls={awaiting} onRun={onRun} onDecline={onDecline} />}
        <Composer
          textareaRef={composerRef}
          streaming={pending !== null}
          model={model}
          models={models}
          onModel={onModel}
          reasoning={reasoning}
          onReasoning={onReasoning}
          editingText={editingText}
          onCancelEdit={onCancelEdit}
          servers={{
            declared: servers,
            tools,
            failures,
            costs,
            reading,
            chosen,
            loaded,
            onChoose,
            onRefresh,
          }}
          onSubmit={onSubmit}
          onStop={onStop}
        />
      </footer>
    </>
  );
}
