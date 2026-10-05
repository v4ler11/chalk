import { memo, useState } from "react";
import { Check, Copy, Hash, Pencil, RefreshCw } from "lucide-react";
import type { Thought, UiMessage, Usage } from "../types";
import { contentText } from "../types";
import { copyText } from "../clipboard";
import { price } from "../money";
import { Markdown } from "./Markdown";
import { Thinking } from "./Thinking";
import { ToolCall } from "./ToolCall";

interface Props {
  message: UiMessage;
  /** Where the message sits in the transcript, which its actions act on. */
  index: number;
  /**
   * The reasoning to show above it, gathered over the turn it belongs to.
   *
   * It is not read from the message itself because a turn that called tools has
   * several rounds behind it: what they reasoned is read once, on the message
   * that answers for them, and a round that only asked for tools shows nothing
   * above its call rows — which is what `null` here means.
   */
  thought: Thought | null;
  /**
   * What the calls of this message were answered with, in the order they were
   * asked for — a `tool` message for each, or `undefined` while one is still
   * waiting. Nothing else carries them: a tool message is drawn inside the row
   * of the call it answered, and `MessageList` is what pairs the two.
   */
  results?: (UiMessage | undefined)[];
  /** Whether the actions are offered; false while a response is arriving. */
  canAct: boolean;
  onRegenerate: (index: number) => void;
  onEdit: (index: number) => void;
}

/**
 * What one answer used, as the provider reported it: the tokens altogether, split
 * into what was sent and what came back, how much of the prompt the provider
 * already had, and the price when the gateway names one. Only the counts it did
 * report are read as zero, so a provider that omits a field is not made to look
 * like a provider that charged nothing.
 */
function consumption(usage: Usage): string {
  // A response OpenRouter replayed from its own cache: nothing was billed, and
  // every counter it reported is a zero, so the counts below would read "0
  // tokens" and mean nothing by it.
  if (usage.cache_status === "HIT") return "cached response · nothing billed";
  const prompt = usage.prompt_tokens ?? 0;
  const completion = usage.completion_tokens ?? 0;
  const total = usage.total_tokens ?? prompt + completion;
  const parts = [
    `${total.toLocaleString()} tokens`,
    `${prompt.toLocaleString()} in, ${completion.toLocaleString()} out`,
  ];
  // The prompt cache's hit rate: how much of what was sent the provider already
  // held, which is what is not paid for again. Reported only where the gateway
  // says — a provider whose model has no such cache leaves the count out rather
  // than reporting nothing cached.
  const cached = usage.prompt_tokens_details?.cached_tokens;
  if (cached != null && prompt > 0) {
    parts.push(`${Math.round((cached / prompt) * 100)}% cached`);
  }
  if (usage.cost != null) parts.push(price(usage.cost));
  return parts.join(" · ");
}

/**
 * Memoized: a committed message keeps its object identity, so it is skipped on
 * re-renders (streaming deltas, new messages) and its Markdown is not re-parsed.
 * `ref` must therefore stay referentially stable — as must the handlers.
 */
export const ChatMessage = memo(function ChatMessage({
  message,
  index,
  thought,
  results,
  canAct,
  onRegenerate,
  onEdit,
}: Props) {
  const toolCalls = message.tool_calls ?? [];
  const content = contentText(message.content);
  // The images a prompt carries, in the order they were attached. Their text,
  // if any, flattens into `content` as before.
  const images: string[] = [];
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (part.type === "image_url") images.push(part.image_url.url);
    }
  }
  const [copied, setCopied] = useState(false);
  const usage = message.usage;

  // What a tool answered is not something the model said: it is what came back
  // from what the model asked for, so it is shown as a record of the call —
  // which tool, and what it said — rather than as a bubble of prose. Nothing of
  // the answer's own belongs to it: no thinking, no markdown to render, no
  // actions, since there is nothing here to ask again for.
  //
  // A tool message is normally drawn by the call it answered, which is what
  // carries the name and the arguments: one arriving here is a call that is not
  // in the transcript — a chat cut short, or a row written by hand — and its
  // name and answer are all there is to show.
  if (message.role === "tool") {
    return (
      <div className="msg tool">
        <div className="bubble">
          <ToolCall name={message.name ?? ""} result={{ text: content, ms: message.ms }} />
        </div>
      </div>
    );
  }

  async function copy() {
    if (!(await copyText(content))) return;
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  // A message that only asked for tools is a step in the turn rather than
  // something said: it is closed up against its neighbours, so a run of rounds
  // reads as one stretch of work instead of a stack of messages — and what it
  // thought is read with the answer it led to.
  const asking = toolCalls.length > 0 && content === "";

  return (
    <div
      className={`msg ${message.role}${asking ? " calls-only" : ""}${canAct ? " acting" : ""}`}
    >
      <div className="bubble">
        {thought && (
          <Thinking text={thought.text} waitMs={thought.waitMs} thinkingMs={thought.thinkingMs} />
        )}
        {message.role === "user" ? (
          // A prompt is shown as it was typed: markdown in it is text, not
          // formatting, and the transcript must not disagree with the wire.
          <>
            {content !== "" && <div className="plain-text">{content}</div>}
            {images.length > 0 && (
              <div className="msg-images">
                {images.map((url, i) => (
                  <img key={i} className="msg-image" src={url} alt={`Attached image ${i + 1}`} />
                ))}
              </div>
            )}
            {/* The design rules off every prompt with its own wavy line. */}
            <div className="prompt-rule" aria-hidden="true" />
          </>
        ) : (
          <Markdown text={content} />
        )}
        {toolCalls.length > 0 && (
          <ul className="tool-calls">
            {toolCalls.map((call, i) => {
              const name = call.type === "function" ? call.function.name : call.custom.name;
              const input = call.type === "function" ? call.function.arguments : call.custom.input;
              // A call and the tool message that answered it are one row, so
              // what it answered with is read from the pairing rather than from
              // a message of its own.
              const answer = results?.[i];
              return (
                <li key={call.id || i}>
                  <ToolCall
                    name={name}
                    args={input}
                    result={
                      answer
                        ? { text: contentText(answer.content), ms: answer.ms }
                        : undefined
                    }
                  />
                </li>
              );
            })}
          </ul>
        )}
        {/* What the message offers, at the very end of it — under the calls, not
            over them.
            
            The row keeps its place in the flow whether or not a pointer is in
            the message: a row taken out of it would be drawn over whatever
            follows, and a prompt's would cover the first calls of the turn it
            asked for, leaving rows that cannot be pressed. It is hidden rather
            than absent, so the buttons are not there to be clicked until the
            message is under the pointer, and the transcript is the same height
            either way. */}
        {message.role === "user" ? (
          <div className="msg-actions">
            <button
              className="msg-action"
              title="Copy message"
              aria-label="Copy message"
              onClick={copy}
            >
              {copied ? <Check /> : <Copy />}
            </button>
            <button
              className="msg-action"
              title="Regenerate response"
              aria-label="Regenerate response"
              onClick={() => onRegenerate(index)}
            >
              <RefreshCw />
            </button>
            <button
              className="msg-action"
              title="Edit message"
              aria-label="Edit message"
              onClick={() => onEdit(index)}
            >
              <Pencil />
            </button>
          </div>
        ) : (
          // An answer's own two options, in the same row beneath it that a
          // prompt's take: the message, and what the response used — which is a
          // tip rather than a click, the icon being what there is to hover. An
          // answer that only called tools offers nothing: there is no text of
          // its own to copy, and what the call cost is the row's own business —
          // the message there is the calls under it.
          content !== "" && (
            <div className="msg-actions">
              <div className="hint">
                <button className="msg-action" aria-label="Copy message" onClick={copy}>
                  {copied ? <Check /> : <Copy />}
                </button>
                <span className="key-hint">Copy message</span>
              </div>
              {usage && (
                <div className="hint">
                  <span
                    className="msg-action usage"
                    role="img"
                    aria-label={`Token usage: ${consumption(usage)}`}
                  >
                    <Hash />
                  </span>
                  <span className="key-hint">{consumption(usage)}</span>
                </div>
              )}
            </div>
          )
        )}
      </div>
    </div>
  );
});
