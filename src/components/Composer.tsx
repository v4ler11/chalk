import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type RefObject } from "react";
import { createPortal } from "react-dom";
import { ArrowUp, Brain, Check, ChevronDown, Hammer, Paperclip, Pencil, Square, X } from "lucide-react";
import { MOD, mod } from "../keybinds";
import { newAttachment, processImage, type Attachment } from "../images";
import { price } from "../money";
import { REASONING_LEVELS, type ReasoningLevel } from "../types";
import { ServersMenu, offeredServers, type ServersProps } from "./ServersMenu";

interface Props {
  /**
   * The field itself. The draft is owned here, but the caret is not: a new chat
   * puts it in, so a request can be typed without reaching for the mouse.
   */
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** A response is in flight: the submit button becomes Stop. */
  streaming: boolean;
  /**
   * The model this chat is holding, named in the chip beside the send button —
   * or, on the channel, the one the next thread will be posted with. Choosing
   * one is a per-chat act and belongs beside the message being written; the list
   * it opens is written in Settings.
   */
  model: string;
  /** The models the settings offer, in their order. */
  models: string[];
  /** The model to post with from the next request on. */
  onModel: (model: string) => void;
  /**
   * How hard the chat is asking the model to think. `""` is off, which is what a
   * request carries when nothing has been chosen.
   */
  reasoning: ReasoningLevel;
  /** The level to ask with from the next request on. */
  onReasoning: (level: ReasoningLevel) => void;
  /** What the open chat's answers have cost altogether, in USD. */
  spent: number;
  /**
   * The text of the prompt being rewritten, or null when the composer is
   * writing a new one. While it is set, sending starts the chat over from that
   * message instead of appending to it.
   */
  editingText: string | null;
  onCancelEdit: () => void;
  /**
   * The model context protocol servers the app knows of, and which of them this
   * chat is sent with: the hammer beside the reasoning control, and the list it
   * opens. The choice is the chat's own, which is why it is passed down here
   * rather than edited in the settings window.
   */
  servers: ServersProps;
  onSubmit: (text: string, images: string[]) => void;
  onStop: () => void;
}

/**
 * Composer card: the images attached to the draft, then the draft, then a row of
 * actions beneath them. The shortcut sends; Enter is a newline. Rewriting an
 * earlier prompt puts its text here, under a line that says so and a button that
 * gives up on it.
 *
 * Owns the draft and its attachments locally so typing and preparing an image
 * re-render only this component, never the message list. Images arrive from the
 * clipboard or the paperclip, which opens the file panel. The reasoning control
 * sits beside the paperclip: a brain while no level is asked for, and the level
 * itself — as a pill — while one is. The tools control sits beside it, in the
 * same shape and colour: the hammer alone while this chat calls no server —
 * which is then the way into the list — and, while it calls any, a pill of the
 * hammer and how many it calls, whose chevron opens that list and whose hammer
 * gives them all up. The model in use sits in the bar's right corner, beside the
 * send button, and opens the list of them; what the chat has cost sits between
 * the two, its newest message's change over the total.
 */
export function Composer({
  textareaRef,
  streaming,
  model,
  models,
  onModel,
  reasoning,
  onReasoning,
  spent,
  editingText,
  onCancelEdit,
  servers,
  onSubmit,
  onStop,
}: Props) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // Which of the three menus is open — the models, the levels, or the servers —
  // and where the control that opened it was: each is drawn at the window's edge
  // rather than inside the composer, whose bar clips everything that would hang
  // out of it.
  const [menu, setMenu] = useState<"reasoning" | "servers" | "model" | null>(null);
  const [anchor, setAnchor] = useState({ left: 0, bottom: 0 });
  const levelRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  // The chip in the bar's right corner, which the model list hangs above.
  const modelRef = useRef<HTMLButtonElement>(null);
  const current = REASONING_LEVELS.find((option) => option.level === reasoning) ?? REASONING_LEVELS[0];
  // Which servers this chat calls, which is what the tools control shows and
  // counts — the servers themselves, since that is what the switches in its list
  // are. The hammer gives them all up and takes them all up again, the way the
  // reasoning pill's brain does with the level.
  const offered = offeredServers(servers.declared, servers.chosen);
  const enabled = servers.declared.filter((server) => server.enabled).length;

  /** The draft an edit displaced, put back if the edit is given up. */
  const stash = useRef("");
  const editing = useRef(false);

  // Anything not ready — still being prepared, or failed — holds the send back,
  // so a request never carries half an image.
  const busy = attachments.some((a) => a.status !== "ready");

  // The button marks a swap of role — Send into Stop — and not its own arrival:
  // a composer arrives with every view, so an animation on the button itself
  // would blink it open each time a thread opens. The flag is cleared by the
  // animation it started, so the class never outlives the pass it was added for.
  const mode = streaming ? "stop" : "send";
  const [swapping, setSwapping] = useState(false);
  const shown = useRef(mode);
  useEffect(() => {
    if (shown.current === mode) return;
    shown.current = mode;
    setSwapping(true);
  }, [mode]);
  const sendClass = `send-btn${swapping ? " swapping" : ""}`;
  const sendSettled = () => setSwapping(false);

  // `value` is read here, not listed as a dependency: this runs on the render
  // that changes `editingText`, where it is the draft the edit is displacing.
  useLayoutEffect(() => {
    if (editingText === null) {
      if (!editing.current) return;
      editing.current = false;
      setValue(stash.current);
      return;
    }
    if (!editing.current) {
      editing.current = true;
      stash.current = value;
    }
    setValue(editingText);
    const el = textareaRef.current;
    if (el) {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingText]);

  // The card is one line tall until the draft needs more; CSS caps the growth.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  /**
   * Attaches each image at once, from the file's own object URL, and prepares it
   * behind the tile: the spinner is only ever over the picture it belongs to.
   */
  function addFiles(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (images.length === 0) return;
    const fresh = images.map((file) => ({ file, attachment: newAttachment(file) }));
    setAttachments((all) => [...all, ...fresh.map((item) => item.attachment)]);
    for (const { file, attachment } of fresh) {
      processImage(file)
        .then((url) => patch(attachment.id, { url, status: "ready" }))
        .catch(() => patch(attachment.id, { status: "error" }));
    }
  }

  /** Applies a change to one attachment, if it is still attached. */
  function patch(id: string, change: Partial<Attachment>) {
    setAttachments((all) =>
      all.map((attachment) => (attachment.id === id ? { ...attachment, ...change } : attachment)),
    );
  }

  function removeAttachment(id: string) {
    const gone = attachments.find((attachment) => attachment.id === id);
    if (gone) URL.revokeObjectURL(gone.preview);
    setAttachments((all) => all.filter((attachment) => attachment.id !== id));
  }

  /**
   * An image on the clipboard is also offered as text — its file name, or a
   * data URL — which the tile already shows, so the text half is dropped with
   * the gesture and only the images are taken.
   */
  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (!files.some((file) => file.type.startsWith("image/"))) return;
    event.preventDefault();
    addFiles(files);
  }

  /**
   * Opens one of the three under the control that asked for it, closing the
   * others; pressing the same control again gives it up. The menu is placed from
   * that control's own rect, so it hangs where the button is.
   */
  function openMenu(which: "reasoning" | "servers" | "model") {
    const el = (which === "reasoning" ? levelRef : which === "servers" ? toolsRef : modelRef).current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setAnchor({ left: rect.left, bottom: window.innerHeight - rect.top + 6 });
    }
    setMenu((open) => (open === which ? null : which));
  }

  function submit() {
    const text = value.trim();
    if (streaming || busy || (text === "" && attachments.length === 0)) return;
    onSubmit(text, attachments.map((attachment) => attachment.url));
    for (const attachment of attachments) URL.revokeObjectURL(attachment.preview);
    setValue("");
    setAttachments([]);
  }

  return (
    <div className="composer">
      {editingText !== null && (
        <div className="composer-editing">
          <span className="composer-editing-label">
            <Pencil />
            Editing message
          </span>
          <button
            className="composer-editing-cancel"
            title="Cancel edit"
            aria-label="Cancel edit"
            onClick={onCancelEdit}
          >
            <X />
          </button>
        </div>
      )}
      {attachments.length > 0 && (
        <div className="composer-attachments">
          {attachments.map((attachment) => (
            <div key={attachment.id} className={`attachment ${attachment.status}`}>
              <img className="attachment-image" src={attachment.preview} alt={attachment.name} />
              {attachment.status === "processing" && (
                <span className="attachment-spinner" aria-hidden="true" />
              )}
              {attachment.status === "error" && (
                <span className="attachment-failed" role="img" aria-label="This image could not be read">
                  !
                </span>
              )}
              <button
                className="attachment-remove"
                title={`Remove ${attachment.name}`}
                aria-label={`Remove ${attachment.name}`}
                onClick={() => removeAttachment(attachment.id)}
              >
                <X />
              </button>
            </div>
          ))}
        </div>
      )}
      <textarea
        ref={textareaRef}
        rows={1}
        value={value}
        placeholder={`Ask anything, press ${MOD}+Enter to send`}
        disabled={streaming}
        onChange={(e) => setValue(e.target.value)}
        onPaste={handlePaste}
        onKeyDown={(e) => {
          // Escape gives up a rewrite, the way Escape gives up the delete
          // question in the history: the draft the edit displaced comes back.
          if (e.key === "Escape" && editingText !== null) {
            e.preventDefault();
            onCancelEdit();
            return;
          }
          // Only the chord sends. Enter is a newline like any other editor's,
          // which is what the placeholder promises, and what makes a prompt of
          // several lines something you can type.
          if (e.key !== "Enter" || !mod(e)) return;
          e.preventDefault();
          submit();
        }}
      />
      <div className="composer-actions">
        <div className="composer-tools">
          {/* Each tool names itself under the pointer: a tip of the app's own,
              since the window draws its own chrome and has no native ones. */}
          <div className="hint">
            <button
              className="composer-tool"
              aria-label="Attach files"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip />
            </button>
            <span className="key-hint">Attach files</span>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(e) => {
              addFiles(Array.from(e.target.files ?? []));
              // So picking the same file again is still a change.
              e.target.value = "";
            }}
          />
          {/* Off, this is the brain alone, in the tools' own grey: one button
              that takes up med — the level in the middle of the three — and
              turns into the pill. A level in force is a pill of two buttons:
              the brain gives the level up, and the level beside it opens the
              menu, which is also where off is. */}
          <div className="hint">
            <div
              ref={levelRef}
              className={`reasoning-pill${current.level === "" ? "" : " on"}`}
            >
              <button
                className="reasoning-btn"
                aria-label={
                  current.level === "" ? "Turn reasoning on (med)" : "Turn reasoning off"
                }
                onClick={() => onReasoning(current.level === "" ? "medium" : "")}
              >
                <Brain />
              </button>
              {current.level !== "" && (
                <button
                  className="reasoning-btn"
                  aria-haspopup="menu"
                  aria-expanded={menu === "reasoning"}
                  aria-label={`Reasoning level: ${current.label}`}
                  onClick={() => openMenu("reasoning")}
                >
                  <span className="reasoning-level">{current.letter}</span>
                  <ChevronDown className="reasoning-chevron" />
                </button>
              )}
            </div>
            <span className="key-hint">Reasoning</span>
          </div>
          {/* The servers this chat calls, in the reasoning control's own shape:
              the hammer alone while it calls none — and then the hammer is what
              opens the list, which is the only way one can be switched back on —
              and, while it calls any, a pill of the hammer and the count: the
              hammer gives them all up, the count with its chevron opens the
              list. Either way the choice is the chat's, written with it, so it
              is made here rather than in the settings, where the servers
              themselves are edited. */}
          <div className="hint">
            <div ref={toolsRef} className={`tools-pill${offered.length > 0 ? " on" : ""}`}>
              {offered.length > 0 ? (
                <button
                  className="tools-btn"
                  aria-label="Call no servers in this chat"
                  onClick={() => servers.onChoose([])}
                >
                  <Hammer />
                </button>
              ) : (
                <button
                  className="tools-btn"
                  aria-expanded={menu === "servers"}
                  aria-controls="composer-servers"
                  aria-label="Tools"
                  onClick={() => openMenu("servers")}
                >
                  <Hammer />
                </button>
              )}
              {offered.length > 0 && (
                <button
                  className="tools-btn"
                  aria-expanded={menu === "servers"}
                  aria-controls="composer-servers"
                  aria-label={`Tools: ${offered.length} of ${enabled} server(s) called`}
                  onClick={() => openMenu("servers")}
                >
                  <span className="tools-count">{offered.length}</span>
                  <ChevronDown className="tools-chevron" />
                </button>
              )}
            </div>
            <span className="key-hint">Tools</span>
          </div>
        </div>
        <div className="composer-right">
          {/* The model this chat is holding, or the one the next thread will be
              posted with. It sits beside the send button because the choice
              belongs to the message being written, and the list it opens is
              written in Settings. */}
          <button
            ref={modelRef}
            className="model-chip"
            aria-haspopup="listbox"
            aria-expanded={menu === "model"}
            onClick={() => openMenu("model")}
          >
            <span className="model-name">{model || "model"}</span>
            <ChevronDown className="chevron" />
          </button>
          {/* What the chat has cost so far: every answer's price, summed, in the
              draft's own corner where the next request is sent from. */}
          {spent > 0 && <span className="composer-cost">{price(spent)}</span>}
          {/* The button holds its place whether or not there is a draft — an
              empty one sends nothing — and the animation marks the swap between
              Send and Stop when the role changes, not the button's arrival. It
              is held back while an image is still being prepared, so nothing is
              sent missing its picture. */}
          {streaming ? (
            <button
              className={sendClass}
              title="Stop"
              aria-label="Stop"
              onClick={onStop}
              onAnimationEnd={sendSettled}
            >
              <Square />
            </button>
          ) : (
            <button
              className={sendClass}
              title="Send"
              aria-label="Send"
              disabled={busy}
              onClick={submit}
              onAnimationEnd={sendSettled}
            >
              <ArrowUp />
            </button>
          )}
        </div>
      </div>
      {/* The levels and the servers, drawn at the window's edge rather than in
          the card: a click anywhere else closes them, the way the model list
          closes. The servers stay open as they are switched — a row is not a
          choice that is over once it is made, and several are usually moved at
          once — so only the backdrop, or the hammer again, closes them. */}
      {menu &&
        createPortal(
          <>
            <div className="menu-backdrop" onClick={() => setMenu(null)} />
            {menu === "reasoning" ? (
              <div
                className="menu reasoning-menu"
                role="menu"
                style={{ left: anchor.left, bottom: anchor.bottom }}
              >
                {REASONING_LEVELS.map((option) => (
                  <button
                    key={option.level || "off"}
                    className={`menu-option${option.level === reasoning ? " active" : ""}`}
                    role="menuitemradio"
                    aria-checked={option.level === reasoning}
                    onClick={() => {
                      onReasoning(option.level);
                      setMenu(null);
                    }}
                  >
                    <span className="menu-option-name">{option.label}</span>
                    {option.level === reasoning && <Check className="menu-option-check" />}
                  </button>
                ))}
              </div>
            ) : menu === "model" ? (
              <div
                className="menu model-menu"
                role="listbox"
                style={{ left: anchor.left, bottom: anchor.bottom }}
              >
                {models.map((name) => (
                  <button
                    key={name}
                    className={`menu-option${name === model ? " active" : ""}`}
                    role="option"
                    aria-selected={name === model}
                    onClick={() => {
                      onModel(name);
                      setMenu(null);
                    }}
                  >
                    <span className="menu-option-name">{name}</span>
                    {name === model && <Check className="menu-option-check" />}
                  </button>
                ))}
                {models.length === 0 && <span className="menu-option empty">No models yet</span>}
              </div>
            ) : (
              <div
                id="composer-servers"
                className="menu servers-menu"
                role="group"
                aria-label="The servers this chat calls"
                style={{ left: anchor.left, bottom: anchor.bottom }}
              >
                <ServersMenu {...servers} />
              </div>
            )}
          </>,
          document.body,
        )}
    </div>
  );
}
