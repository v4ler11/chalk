import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type RefObject,
} from "react";
import { ArrowUp, Brain, ChevronDown, Hammer, Paperclip, Pencil, Square, X } from "lucide-react";
import { MOD, mod } from "../keybinds";
import { newAttachment, processImage, type Attachment } from "../images";
import { REASONING_LEVELS, type ReasoningLevel } from "../types";
import { ServersMenu, type ServersProps } from "./ServersMenu";
import { Hint } from "./Hint";
import { Menu, MenuOption, useOpenMenu } from "./Menu";
import { offeredServers } from "../lazy";
import { spend } from "../money";
import { useSendRoom } from "../useSendRoom";

/** The menus the composer's own bar opens: the levels, the servers, the models. */
type MenuName = "reasoning" | "servers" | "model";

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
   * What this chat has cost in USD, and what its newest message added — both
   * summed by the pane, which is where the transcript is. Either may be zero,
   * and a zero is written as nothing rather than as `$0.00`.
   */
  cost: { total: number; latest: number };
  /**
   * How hard the chat is asking the model to think. `""` is off, which is what a
   * request carries when nothing has been chosen.
   */
  reasoning: ReasoningLevel;
  /** The level to ask with from the next request on. */
  onReasoning: (level: ReasoningLevel) => void;
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
 * The composer: one card holding the field the prompt is written in — with the
 * shortcut to send beside the button that does it — and, under the card, the row
 * of controls that belong to the message rather than to the text: what is
 * attached and what the chat asks for on the left, and what it has cost and what
 * it is asking on the right.
 *
 * The shortcut sends; Enter is a newline. Rewriting an earlier prompt puts its
 * text here, under a line that says so and a button that gives up on it.
 *
 * Owns the draft and its attachments locally so typing and preparing an image
 * re-render only this component, never the message list. Images arrive from the
 * clipboard or the paperclip, which opens the file panel. The reasoning control
 * sits beside the paperclip: a brain while no level is asked for, and the level
 * itself — as a pill — while one is. The tools control sits beside it, in the
 * same shape and colour: the hammer alone while this chat calls no server —
 * which is then the way into the list — and, while it calls any, a pill of the
 * hammer and how many it calls, whose chevron opens that list and whose hammer
 * gives them all up. The cost and the model in use close the row: what the chat
 * has spent, and which model it is spending it on, which is also the way into
 * the list of them.
 */
export function Composer({
  textareaRef,
  streaming,
  model,
  models,
  onModel,
  cost,
  reasoning,
  onReasoning,
  editingText,
  onCancelEdit,
  servers,
  onSubmit,
  onStop,
}: Props) {
  const [value, setValue] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);
  // Which of the three menus is open: the levels, the servers, or the models.
  // Each is drawn at the window's edge rather than inside the composer, whose
  // bar clips everything that would hang out of it, and each is placed from the
  // rect of the control that opened it.
  const menus = useOpenMenu<MenuName>();
  const levelRef = useRef<HTMLDivElement>(null);
  const toolsRef = useRef<HTMLDivElement>(null);
  // The column the draft keeps clear at its right end: the shortcut and the
  // button, measured into the row so the draft's words wrap before them.
  const sendRef = useRef<HTMLDivElement>(null);
  useSendRoom(sendRef);
  // The chip in the bar's right corner, which the model list hangs above.
  const modelRef = useRef<HTMLButtonElement>(null);
  const current = REASONING_LEVELS.find((option) => option.level === reasoning) ?? REASONING_LEVELS[0];
  // Which servers this chat calls, which is what the tools control shows and
  // counts — the servers themselves, since that is what the switches in its list
  // are. The hammer gives them all up and takes them all up again, the way the
  // reasoning pill's brain does with the level.
  const offered = offeredServers(servers.declared, servers.chosen);
  const enabled = servers.declared.filter((server) => server.enabled).length;
  // What this chat has spent and what its newest message added, written as one
  // line — or as nothing while the two of them still have nothing to say.
  const costText = spend(cost.total, cost.latest);

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
  const sendClass = `btn btn--primary btn--icon btn--round send-btn${swapping ? " swapping" : ""}`;
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

  // The draft is as tall as its words need at the width the field has, re-taken
  // when either changes. The words are `value`; the width is the field's own
  // content box, and both the window's measure and the shortcut giving way to
  // Stop move it — the button takes its room out of the field's right padding,
  // so the same words wrap into more lines once the button is wider. A height
  // left from the wider draft is shorter than the re-wrapped one while the box
  // is still under its own cap, and the box then has nothing to scroll: the
  // field clips the lines past its end, out of reach until the next keystroke.
  // The height written is the field's own scroll height, taken from the box that
  // carries it, and this is its one copy — both fits below read it.
  const fitDraft = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [textareaRef]);

  useLayoutEffect(() => {
    fitDraft();
  }, [value, fitDraft]);

  // The field's width, followed for the fit above. What is compared is the
  // content box, not the border box: the border box is the card's own measure
  // and does not move when the button takes room from the words' side, so only
  // the content width says whether the same words still wrap the same way. A
  // width already fitted is ignored, since the height the fit writes comes back
  // as a size of its own and following it would be the loop. It is disconnected
  // with the field rather than with a render: a window narrowed between two
  // keystrokes re-wraps the draft in the frame it narrows.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    let width = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === width) return;
      width = entry.contentRect.width;
      fitDraft();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [textareaRef, fitDraft]);

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

  function submit() {
    const text = value.trim();
    if (streaming || busy || (text === "" && attachments.length === 0)) return;
    onSubmit(text, attachments.map((attachment) => attachment.url));
    for (const attachment of attachments) URL.revokeObjectURL(attachment.preview);
    setValue("");
    setAttachments([]);
  }

  return (
    <>
      {/* The card: the box the prompt is written in. What is attached to the
          draft and what the draft is rewriting stand above the field, since both
          are about the text itself. */}
      <div className="composer">
      {editingText !== null && (
        <div className="composer-editing">
          <span className="composer-editing-label">
            <Pencil />
            Editing message
          </span>
          <button
            className="btn btn--quiet btn--icon-xs"
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
                className="btn btn--overlay"
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
      <div className="composer-row">
        {/* The field rides in a box of its own: that box is what scrolls when a
            draft outgrows it, so reaching either end of it is a hard stop — a
            `textarea` scrolls itself and rubber-bands past its end, which is
            what the transcript's own box does not do. */}
        <div className="composer-draft">
          <textarea
            className="input input--bare"
            ref={textareaRef}
            rows={1}
            value={value}
            placeholder="Ask anything"
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
              // which is what the hint beside the button says, and what makes a
              // prompt of several lines something you can type.
              if (e.key !== "Enter" || !mod(e)) return;
              e.preventDefault();
              submit();
            }}
          />
        </div>
        {/* The shortcut is written where it is used rather than in the
            placeholder: the placeholder is the first thing a draft erases, and
            this is what the reader wants to know before they have typed
            anything — and after, while the button they would reach for the
            mouse to press is already under their eye. */}
        <div className="composer-send" ref={sendRef}>
          <span className="composer-hint">{`${MOD}+Enter`}</span>
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
      </div>
      {/* The row under the card: what belongs to the message rather than to the
          text in it. It is a row of the bar rather than of the card, so the card
          is the box the prompt is written in and nothing else, and the controls
          that are only read — the cost, the model — stand with it. */}
      <div className="composer-toolbar">
        <div className="composer-tools">
          {/* Each tool names itself under the pointer: a tip of the app's own,
              since the window draws its own chrome and has no native ones. */}
          <Hint label="Attach files">
            <button
              className="btn btn--bare"
              aria-label="Attach files"
              onClick={() => fileRef.current?.click()}
            >
              <Paperclip />
            </button>
          </Hint>
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
          <Hint label="Reasoning">
            <div
              ref={levelRef}
              className={`pill${current.level === "" ? "" : " pill--on"}`}
            >
              <button
                className="pill__half"
                aria-label={
                  current.level === "" ? "Turn reasoning on (med)" : "Turn reasoning off"
                }
                onClick={() => onReasoning(current.level === "" ? "medium" : "")}
              >
                <Brain />
              </button>
              {current.level !== "" && (
                <button
                  className="pill__half"
                  aria-haspopup="menu"
                  aria-expanded={menus.open === "reasoning"}
                  aria-label={`Reasoning level: ${current.label}`}
                  onClick={() => menus.toggle("reasoning")}
                >
                  <span className="pill__value">{current.letter}</span>
                  <ChevronDown />
                </button>
              )}
            </div>
          </Hint>
          {/* The servers this chat calls, in the reasoning control's own shape:
              the hammer alone while it calls none — and then the hammer is what
              opens the list, which is the only way one can be switched back on —
              and, while it calls any, a pill of the hammer and the count: the
              hammer gives them all up, the count with its chevron opens the
              list. Either way the choice is the chat's, written with it, so it
              is made here rather than in the settings, where the servers
              themselves are edited. */}
          <Hint label="Tools">
            <div ref={toolsRef} className={`pill${offered.length > 0 ? " pill--on" : ""}`}>
              {offered.length > 0 ? (
                <button
                  className="pill__half"
                  aria-label="Call no servers in this chat"
                  onClick={() => servers.onChoose([])}
                >
                  <Hammer />
                </button>
              ) : (
                <button
                  className="pill__half"
                  aria-expanded={menus.open === "servers"}
                  aria-controls="composer-servers"
                  aria-label="Tools"
                  onClick={() => menus.toggle("servers")}
                >
                  <Hammer />
                </button>
              )}
              {offered.length > 0 && (
                <button
                  className="pill__half"
                  aria-expanded={menus.open === "servers"}
                  aria-controls="composer-servers"
                  aria-label={`Tools: ${offered.length} of ${enabled} server(s) called`}
                  onClick={() => menus.toggle("servers")}
                >
                  <span className="pill__value">{offered.length}</span>
                  <ChevronDown />
                </button>
              )}
            </div>
          </Hint>
        </div>
        <div className="composer-right">
          {/* What the chat has spent, and what the newest message added to it.
              Read rather than pressed, and written in the app's monospace — it
              is a number — so it stands apart from the model beside it. A chat
              that has spent nothing says nothing here. */}
          {costText !== "" && <span className="composer-cost">{costText}</span>}
          {/* The model this chat is holding, or the one the next thread will be
              posted with. It closes the row because the choice belongs to the
              message being written, and the list it opens is written in
              Settings. */}
          <button
            ref={modelRef}
            className="btn btn--chip"
            aria-haspopup="listbox"
            aria-expanded={menus.open === "model"}
            onClick={() => menus.toggle("model")}
          >
            <span className="model-name">{model || "model"}</span>
            <ChevronDown />
          </button>
        </div>
      </div>
      {/* The levels, the servers and the models, hung from their own controls at
          the window's edge rather than in the bar: a click anywhere else closes
          them. The servers stay open as they are switched, since a row is not a
          choice that is over once it is made and several are usually moved at
          once, so only the backdrop, or the hammer again, closes them. */}
      {menus.open === "reasoning" && (
        <Menu anchor={levelRef} className="reasoning-menu" role="menu" onClose={menus.close}>
          {REASONING_LEVELS.map((option) => (
            <MenuOption
              key={option.level || "off"}
              label={option.label}
              selected={option.level === reasoning}
              role="menuitemradio"
              onClick={() => {
                onReasoning(option.level);
                menus.close();
              }}
            />
          ))}
        </Menu>
      )}
      {menus.open === "model" && (
        <Menu anchor={modelRef} className="model-menu" role="listbox" onClose={menus.close}>
          {models.map((name) => (
            <MenuOption
              key={name}
              label={name}
              selected={name === model}
              role="option"
              onClick={() => {
                onModel(name);
                menus.close();
              }}
            />
          ))}
          {models.length === 0 && <span className="menu-option empty">No models yet</span>}
        </Menu>
      )}
      {menus.open === "servers" && (
        <Menu
          anchor={toolsRef}
          id="composer-servers"
          className="servers-menu"
          role="group"
          label="The servers this chat calls"
          onClose={menus.close}
        >
          <ServersMenu {...servers} />
        </Menu>
      )}
    </>
  );
}
