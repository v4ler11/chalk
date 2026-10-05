import type { RefObject } from "react";
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
import { Composer } from "./Composer";
import { ToolApproval } from "./ToolApproval";

interface Props {
  messages: UiMessage[];
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
  spent: number;
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
  messages,
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
  spent,
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
  return (
    <>
      <MessageList
        messages={messages}
        pending={pending}
        error={error}
        follow={follow}
        onFollowChange={onFollowChange}
        canAct={canAct}
        onRegenerate={onRegenerate}
        onEdit={onEdit}
      />

      <footer className="composer-bar">
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
          spent={spent}
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
