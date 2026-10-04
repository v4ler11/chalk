import { useState } from "react";
import { Check, ChevronDown, EllipsisVertical } from "lucide-react";
import { MOD } from "../keybinds";

interface Props {
  /** The model the open chat is holding, named in the chip. */
  model: string;
  /** The models the settings offer, in their order. */
  models: string[];
  onPick: (model: string) => void;
  /** Whether the plain-JSON view is standing in for the transcript. */
  jsonView: boolean;
  onJsonView: (on: boolean) => void;
}

/**
 * The chat panel's own nav: the strip across the top of the panel, which drags
 * the window wherever the controls are not, the model in use at its right, and
 * the three-dots beside it — the window's view switches, which outlive the chat
 * they are taken in.
 *
 * The chip opens the list of models: choosing one is a per-chat act and belongs
 * beside the chat, while the list itself is written in Settings, which the
 * sidebar's own row opens.
 *
 * The rule under it is what separates this nav from the transcript below.
 */
export function ChatNav({ model, models, onPick, jsonView, onJsonView }: Props) {
  const [open, setOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);

  return (
    <div className="chat-nav" data-tauri-drag-region="deep">
      <div className="model-picker">
        <button
          className="model-chip"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="model-name">{model || "model"}</span>
          <ChevronDown className="chevron" />
        </button>

        {open && (
          <>
            {/* Anywhere else closes the list, which is what a click outside a
                menu is for. */}
            <div className="menu-backdrop" onClick={() => setOpen(false)} />
            <div className="menu below model-menu" role="listbox">
              {models.map((name) => (
                <button
                  key={name}
                  className={`menu-option${name === model ? " active" : ""}`}
                  role="option"
                  aria-selected={name === model}
                  onClick={() => {
                    onPick(name);
                    setOpen(false);
                  }}
                >
                  <span className="menu-option-name">{name}</span>
                  {name === model && <Check className="menu-option-check" />}
                </button>
              ))}
              {models.length === 0 && <span className="menu-option empty">No models yet</span>}
            </div>
          </>
        )}
      </div>

      {/* The view switches, of which there is one: the conversation as plain
          JSON instead of the transcript and the composer. It is the window's
          rather than the chat's — switching chats while it is on keeps showing
          JSON, and the sidebar's own row is what leaves it. */}
      <div className="nav-menu">
        <button
          className={`icon-btn${viewOpen ? " active" : ""}`}
          aria-haspopup="menu"
          aria-expanded={viewOpen}
          aria-label="View"
          onClick={() => setViewOpen((o) => !o)}
        >
          <EllipsisVertical className="icon" />
        </button>

        {viewOpen && (
          <>
            <div className="menu-backdrop" onClick={() => setViewOpen(false)} />
            <div className="menu below view-menu" role="menu">
              <button
                className={`menu-option${jsonView ? " active" : ""}`}
                role="menuitemcheckbox"
                aria-checked={jsonView}
                onClick={() => {
                  onJsonView(!jsonView);
                  setViewOpen(false);
                }}
              >
                <span className="menu-option-name">JSON view</span>
                {/* The shortcut is named where its command lives, as the rail's
                    buttons name theirs. */}
                <kbd>{MOD}J</kbd>
                {jsonView && <Check className="menu-option-check" />}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
