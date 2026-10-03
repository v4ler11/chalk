import { useState } from "react";
import { Check, ChevronDown } from "lucide-react";

interface Props {
  /** The model the open chat is holding, named in the chip. */
  model: string;
  /** The models the settings offer, in their order. */
  models: string[];
  onPick: (model: string) => void;
}

/**
 * The chat panel's own nav: the strip across the top of the panel, which drags
 * the window wherever the controls are not, and the model in use at its right.
 *
 * The chip opens the list of models: choosing one is a per-chat act and belongs
 * beside the chat, while the list itself is written in Settings, which the
 * sidebar's own row opens.
 *
 * The rule under it is what separates this nav from the transcript below.
 */
export function ChatNav({ model, models, onPick }: Props) {
  const [open, setOpen] = useState(false);

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
    </div>
  );
}
