import { useState, type ReactNode } from "react";
import { Cpu, FileText, Plug, Settings2 } from "lucide-react";
import type { AppConfig } from "../types";
import { Field } from "./Controls";
import { McpSettings } from "./McpSettings";
import { ModelsSettings } from "./ModelsSettings";
import { SectionNav } from "./SectionNav";
import { setTheme, useTheme } from "../theme";

interface Props {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => void;
  /** Shown above the form, when the window has something to report. */
  notice?: ReactNode;
  /** Opens the log window; the button for it sits at the foot of the tabs. */
  onOpenLogs?: () => void;
  /** The section a page opens on, where it is not the first: the harness's own
   *  way in, so a page can be looked at without being driven to it. */
  initialTab?: TabId;
}

/**
 * The settings the window is divided into, in the order its own sidebar lists
 * them. Each is one page of the form.
 */
const TABS = [
  { id: "general", label: "General", icon: Settings2 },
  { id: "models", label: "Models", icon: Cpu },
  { id: "customization", label: "Customization", icon: FileText },
  { id: "mcp", label: "MCP", icon: Plug },
] as const;

export type TabId = (typeof TABS)[number]["id"];

/**
 * What the window may wear, in the order the control lists it: the two schemes
 * by name, then the desktop's own answer to which of them to wear.
 *
 * The three are the same kind of thing — a choice, not a setting of the file the
 * settings write — which is why they are one control rather than a switch
 * and a checkbox beside it.
 */
const THEMES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
] as const;

export function SettingsPanel({
  config,
  onChange,
  notice,
  onOpenLogs,
  initialTab = "general",
}: Props) {
  const [tab, setTab] = useState<TabId>(initialTab);

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
            <button className="nav-row" onClick={onOpenLogs}>
              Logs
            </button>
          )
        }
      />

      <div className={`settings-main${tab === "mcp" ? " settings-main--mcp" : ""}`}>
        {notice}

        {/* The MCP page is not part of the config form: it edits `mcp.json`,
            and keeps its own actions — it is a list of servers, added to and
            tried one at a time, rather than fields about this window. Every
            other page writes itself as it is edited: a config is a fact about
            the file, not a form under review, so there is no Save under any of
            them. It is also the one page that brings its own columns, and so
            its own frame: the servers are a list of the settings' own kind,
            read beside the sections, and they stand as those stand — which is
            what `settings-main--mcp` says. */}
        {tab === "mcp" ? (
          <McpSettings />
        ) : tab === "general" ? (
          <GeneralTab config={config} onChange={onChange} />
        ) : tab === "models" ? (
          <ModelsSettings config={config} onChange={onChange} />
        ) : (
          <CustomizationTab config={config} onChange={onChange} />
        )}
      </div>
    </>
  );
}

/**
 * Who is posting, and the scheme the window wears — the one control here that
 * the settings file does not hold.
 *
 * What requests go to and what they are sent with used to stand here, beside
 * the key: they are the models' page now, where each gateway — the app's own
 * provider among them, its first tab — holds its own key, so there is one place
 * a key is written and one answer to where a model is asked for.
 */
function GeneralTab({
  config,
  onChange,
}: {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => void;
}) {
  // Read from the window rather than from the config: the scheme is not one of
  // the fields this form is a draft of, so it is not the page's to hold.
  const theme = useTheme();

  return (
    <div className="settings">
      <Field label="Name">
        <input
          type="text"
          className="input"
          value={config.name}
          placeholder="You"
          onChange={(e) => onChange({ name: e.target.value })}
        />
      </Field>
      <p className="settings-note">
        Drawn beside what you post in the channel, with a circle of its initials.
      </p>
      {/* The one control on this page that is not a field of the form: the scheme
          belongs to the window, so it is applied where it is chosen and kept by
          the window. The file has nothing to write for it, and nothing to reset
          it to either. */}
      <div className="settings-appearance">
        <span className="field-label">Appearance</span>
        <div className="seg" role="group" aria-label="Appearance">
          {THEMES.map(({ id, label }) => (
            <button
              key={id}
              className="btn btn--sm"
              aria-pressed={theme === id}
              onClick={() => setTheme(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="settings-note">
          Applied at once, and kept for this window. The file the settings write holds where
          requests go and what they are sent with, not what the window looks like.
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
      <Field label="System prompt" className="settings-prompt">
        <textarea
          className="input input--area"
          value={config.systemPrompt}
          rows={10}
          spellCheck={false}
          placeholder="Sent ahead of every chat, as the model's standing instructions"
          aria-label="System prompt"
          onChange={(e) => onChange({ systemPrompt: e.target.value })}
        />
      </Field>
    </div>
  );
}
