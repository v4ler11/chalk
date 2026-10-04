import { useState, type ReactNode } from "react";
import { FileText, Plug, Plus, Settings2, X } from "lucide-react";
import type { AppConfig } from "../types";
import { McpSettings } from "./McpSettings";
import { SectionNav } from "./SectionNav";

interface Props {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => void;
  onSave: () => void;
  /** Set by a save, cleared by the next edit. */
  saved?: boolean;
  /** Shown above the form, when the window has something to report. */
  notice?: ReactNode;
  /** Opens the log window; the button for it sits at the foot of the tabs. */
  onOpenLogs?: () => void;
}

/**
 * The settings the window is divided into, in the order its own sidebar lists
 * them. Each is one page of the form.
 */
const TABS = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "customization", label: "Customization", icon: FileText },
  { id: "mcp", label: "MCP", icon: Plug },
] as const;

type TabId = (typeof TABS)[number]["id"];

/**
 * Where OpenRouter's name sends requests. The backend is what really holds it —
 * and what turns its response cache on — so this is the same URL written out
 * for the page to name, not a second source of it.
 */
const OPENROUTER_URL = "https://openrouter.ai/api/v1";

/** The two providers the selector offers, in the order it lists them. */
const PROVIDERS = [
  { id: "openrouter", label: "OpenRouter" },
  { id: "custom", label: "Custom" },
] as const;

/** Characters of the key left in the clear while the field is not focused. */
const VISIBLE = 5;

/**
 * The API key's field.
 *
 * The key is shown while the field has the caret, so it can be read and
 * corrected, and masked the rest of the time: its first five characters, then
 * one asterisk per character after them. A `type="password"` field is not used
 * for the mask — WebKit takes that glyph from the font, and no CSS keyword makes
 * it an asterisk (`-webkit-text-security` offers disc, circle and square only) —
 * so the mask is simply what the field holds while it is away from the caret.
 */
function SecretInput({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const [focused, setFocused] = useState(false);
  const masked = `${value.slice(0, VISIBLE)}${"*".repeat(Math.max(0, value.length - VISIBLE))}`;

  return (
    <input
      type="text"
      className="secret"
      value={focused ? value : masked}
      // Held read-only away from the caret, so the mask can never be written
      // back as the key by a stray edit.
      readOnly={!focused}
      autoComplete="off"
      spellCheck={false}
      aria-label="API key"
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function SettingsPanel({
  config,
  onChange,
  onSave,
  saved = false,
  notice,
  onOpenLogs,
}: Props) {
  const [tab, setTab] = useState<TabId>("general");

  /** Replaces the whole list, which is what every edit to it amounts to. */
  function change(models: string[]) {
    onChange({ models });
  }

  /** Rewrites one model in place, leaving the order — and so the default — alone. */
  function replace(index: number, value: string) {
    change(config.models.map((name, i) => (i === index ? value : name)));
  }

  return (
    <>
      <SectionNav
        label="Settings sections"
        sections={[...TABS]}
        active={tab}
        onSelect={(id) => setTab(id as TabId)}
        // The log window is not a setting, so it does not take a tab: it keeps
        // the foot of the list, where the app's own sidebar keeps Settings.
        footer={
          onOpenLogs && (
            <button className="settings-open-logs" onClick={onOpenLogs}>
              Logs
            </button>
          )
        }
      />

      <div className="settings-main">
        {notice}

        {/* The MCP page is not part of the config form: it edits `mcp.json`,
            and keeps its own actions, so the window's Save is not drawn with
            it. */}
        {tab === "mcp" ? (
          <McpSettings />
        ) : (
          <>
            {tab === "general" ? (
              <GeneralTab config={config} onChange={onChange} change={change} replace={replace} />
            ) : (
              <CustomizationTab config={config} onChange={onChange} />
            )}

            <div className="settings-actions">
              <button onClick={onSave}>Save</button>
              {saved && <span className="settings-saved">Saved</span>}
            </div>
          </>
        )}
      </div>
    </>
  );
}

/** Where requests go, what they are sent with, and which model they ask for. */
function GeneralTab({
  config,
  onChange,
  change,
  replace,
}: {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => void;
  change: (models: string[]) => void;
  replace: (index: number, value: string) => void;
}) {
  return (
    <div className="settings">
      <label>
        <span>Provider</span>
        <select
          value={config.provider}
          onChange={(e) => onChange({ provider: e.target.value })}
        >
          {PROVIDERS.map((provider) => (
            <option key={provider.id} value={provider.id}>
              {provider.label}
            </option>
          ))}
        </select>
      </label>
      {/* Where a custom provider is, and — for OpenRouter — where it is going
          anyway, said out loud: the cache that comes with it is worth knowing
          about, since it is what makes a repeated request free. */}
      {config.provider === "custom" ? (
        <label>
          <span>Endpoint</span>
          <input
            type="text"
            value={config.endpoint}
            placeholder="https://example.com/v1"
            onChange={(e) => onChange({ endpoint: e.target.value })}
          />
        </label>
      ) : (
        <p className="settings-note">
          Requests go to <code>{OPENROUTER_URL}</code>. A request identical to one made within the
          last five minutes is answered from OpenRouter's own cache — free, and without waiting for
          a model.
        </p>
      )}
      <label>
        <span>API key</span>
        <SecretInput value={config.apiKey} onChange={(apiKey) => onChange({ apiKey })} />
      </label>
      <div className="settings-models">
        <span className="settings-label">Models</span>
        {config.models.map((name, i) => (
          <div className="settings-model" key={i}>
            <input
              type="text"
              value={name}
              placeholder="a model id"
              aria-label={`Model ${i + 1}`}
              onChange={(e) => replace(i, e.target.value)}
            />
            {/* The list is the app's only source of models, so it cannot be
                emptied: the last row's button is drawn, but disabled. */}
            <button
              className="settings-model-remove"
              title="Remove model"
              aria-label={`Remove ${name || "this model"}`}
              disabled={config.models.length === 1}
              onClick={() => change(config.models.filter((_, j) => j !== i))}
            >
              <X />
            </button>
          </div>
        ))}
        <button className="settings-model-add" onClick={() => change([...config.models, ""])}>
          <Plus />
          Add model
        </button>
        <p className="settings-note">
          The first is what a new chat starts from, once the history has nothing to say; every chat
          keeps the model it was given.
        </p>
      </div>
    </div>
  );
}

/**
 * How the model is told to answer: the system prompt, sent ahead of the
 * transcript on every request. It is not a message the window holds, so a chat
 * keeps its own history clean of it.
 */
function CustomizationTab({
  config,
  onChange,
}: {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => void;
}) {
  return (
    <div className="settings">
      <label className="settings-prompt">
        <span>System prompt</span>
        <textarea
          value={config.systemPrompt}
          rows={10}
          spellCheck={false}
          placeholder="Sent ahead of every chat, as the model's standing instructions"
          aria-label="System prompt"
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
        />
      </label>
    </div>
  );
}
