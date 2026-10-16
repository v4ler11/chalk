import { useState } from "react";
import { ChevronDown, Plus } from "lucide-react";
import type { AppConfig, Gateway } from "../types";
import { settingsModel } from "../conversation";
import { Field, SecretInput } from "./Controls";
import { RowDelete, useDeleteQuestion } from "./RowDelete";

/** What a gateway is called, by the name it carries in a model id. */
const GATEWAY_NAMES: Record<string, string> = {
  openrouter: "OpenRouter",
  openai: "OpenAI",
  anthropic: "Anthropic",
  google: "Google",
  deepseek: "DeepSeek",
  groq: "Groq",
  ollama: "Ollama",
  lmstudio: "LM Studio",
  mistral: "Mistral",
  xai: "xAI",
  qwen: "Qwen",
  /**
   * The app's own provider, when it is not OpenRouter: any OpenAI-compatible
   * endpoint, named by its URL rather than by a service — a model server of the
   * reader's own, or a proxy in front of one. It is the backend's `custom`, and
   * the word the file writes for it.
   */
  custom: "OpenAI Compatible",
};

/**
 * The names the backend holds a URL for — `known()` in `settings.rs`, which is
 * what really resolves them. The form needs the list to know when an endpoint
 * has to be written, and the note under the field says which names those are.
 */
const KNOWN = [
  "openrouter",
  "openai",
  "google",
  "deepseek",
  "groq",
  "mistral",
  "xai",
  "ollama",
  "lmstudio",
];

/**
 * What the Add provider screen offers: the app's own provider, in both the
 * arrangements it has. OpenRouter is the service this app was built around —
 * whose response cache it asks for, and whose own word on a response it reads
 * back — and OpenAI Compatible is any endpoint that speaks the same API: a model
 * server of the reader's own, or a proxy in front of one. The two are the whole
 * of the choice because a model that names no gateway is asked of the app's own
 * provider, and these are the two places it can be.
 *
 * A service with a name of its own is a gateway rather than a provider: it is
 * declared in the file, its name leads its models' ids, and it keeps its own tab
 * and its own key — nothing here starts one, since a gateway is a name and a
 * name written into a form is a prefix no one chose.
 */
const PROVIDERS = ["openrouter", "custom"] as const;

/** What a provider calls a model, so the field shows what one looks like. */
const FIRST_EXAMPLES: Record<string, string> = {
  openrouter: "deepseek/deepseek-v4.1-flash",
  custom: "llama3.2",
};

/** A name a gateway calls a model, so the field shows what one looks like. */
const EXAMPLES: Record<string, string> = {
  openrouter: "anthropic/claude-sonnet-4.5",
  openai: "gpt-5",
  anthropic: "claude-opus-4.1",
  google: "gemini-2.5-pro",
  deepseek: "deepseek-chat",
  groq: "llama-3.3-70b-versatile",
  mistral: "mistral-large-latest",
  xai: "grok-4",
  ollama: "llama3.2",
  lmstudio: "qwen2.5-7b-instruct",
};

/**
 * The tab the app's own provider has: the models that name no gateway of their
 * own are asked of it, so it is where they are read. It is not a name a gateway
 * can carry — the empty one — since every tab is only ever one of the two.
 */
const OWN = "";
/** The tab that adds a gateway, which is a screen rather than a list. */
const NEW = "__new";

/** The gateway a model is asked of: what its id leads with, when that names one. */
function gatewayOf(id: string, gateways: Gateway[]): string {
  const at = id.indexOf("/");
  const segment = at > 0 ? id.slice(0, at) : "";
  return gateways.some((g) => g.id === segment) ? segment : OWN;
}

/** The model's own name: its id without the prefix its gateway fixes. */
function nameOf(id: string, gateways: Gateway[]): string {
  const gateway = gatewayOf(id, gateways);
  return gateway === OWN ? id : id.slice(gateway.length + 1);
}

/** What a gateway is called: the service's own name where the app knows one. */
function gatewayName(id: string): string {
  return GATEWAY_NAMES[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

/** What an id leads with, which is the gateway it would be asked of. */
function leadsWith(id: string): string {
  const at = id.indexOf("/");
  return at > 0 ? id.slice(0, at) : "";
}

/** Why an id cannot be added, or `""` when it can. */
function problem(id: string, models: string[]): string {
  // An empty name is not a fault, only a field nothing has been typed in yet:
  // the matter is the Add button's own, which stays shut while it is empty.
  if (id.slice(id.indexOf("/") + 1).trim() === "") return "";
  if (/\s/.test(id)) return "A model id has no spaces.";
  if (models.includes(id)) return "That model is already in the list.";
  return "";
}

/** Why a model typed on the app's own tab cannot be added, or `""` when it can. */
function ownProblem(id: string, gateways: Gateway[]): string {
  const segment = leadsWith(id);
  if (segment === "" || !gateways.some((g) => g.id === segment)) return "";
  return `That is ${gatewayName(segment)}'s: its models lead with "${segment}/", on its own tab.`;
}

/**
 * The Models screen: which models the chat picker offers, read as a tab per
 * gateway, and the screen that starts a gateway the app does not have.
 *
 * The list is still the one list the config holds, in the picker's order — the
 * tabs are a way of reading it, grouped by the gateway each model is asked of,
 * not a second store — and what a new chat starts from is a model named beside
 * it rather than a place in it. That grouping is the backend's own rule: a model
 * whose id leads with a configured gateway's name is sent to that gateway with
 * that gateway's key, and every other model is sent to the app's provider. So an
 * Anthropic model served by OpenRouter — the id `anthropic/claude-sonnet-4.5`,
 * with OpenRouter the provider and no Anthropic configured — stays on the
 * OpenRouter tab, its id naming the model rather than the way to reach it.
 *
 * The app's provider has no name of its own to be read under, so the Add
 * provider screen is where it is decided: OpenRouter, or an OpenAI-compatible
 * endpoint named by its URL — and one already set up is not offered a second
 * time, since what it holds is read and added to on its own tab. Models whose
 * ids name no gateway are asked of whichever it is, which is what makes a local
 * model server and a service's own API two arrangements of the one tab rather
 * than two features. A service with a name of its own is a gateway instead —
 * declared in the file, its name leading its models' ids — and keeps a tab and a
 * key of its own.
 *
 * A tab's key comes first in it, before any model is chosen, because it is what
 * the list is for: a gateway cannot be reached without one.
 */
export function ModelsSettings({
  config,
  onChange,
}: {
  config: AppConfig;
  onChange: (patch: Partial<AppConfig>) => void;
}) {
  const models = config.models;
  const gateways = config.gateways;
  /**
   * The app's own provider, read as the gateway it is: the one every model that
   * names no gateway of its own is asked of.
   */
  const own = config.provider === "custom" ? "custom" : config.provider;

  const tabs = [OWN, ...gateways.map((g) => g.id)];
  const [chosen, setChosen] = useState<string>(OWN);
  const [justAdded, setJustAdded] = useState("");
  // A tab whose last model went away is not a tab, so it falls back to the app's
  // own provider — which is always there, since a model cannot name a gateway
  // that does not exist.
  const open = chosen === NEW || tabs.includes(chosen) ? chosen : OWN;

  const fallback = settingsModel(config);
  /** What a tab is called: the gateway's own name, or the app's provider's. */
  const label = (key: string) => gatewayName(key === OWN ? own : key);
  /** The models a tab holds, in the list's own order. */
  const held = (key: string) => models.filter((m) => gatewayOf(m, gateways) === key);
  const gateway = gateways.find((g) => g.id === open);

  function add(id: string) {
    onChange({ models: [...models, id] });
    setJustAdded(id);
    setChosen(gatewayOf(id, gateways));
  }

  function remove(id: string) {
    const left = models.filter((m) => m !== id);
    // The list's own order is the picker's, and the default is a model rather
    // than a place in it — so removing a model is removing a model, and only a
    // default that named this one has to move: it becomes the head, which is
    // what the backend would resolve a default it no longer holds to anyway.
    onChange({
      models: left,
      defaultModel: id === fallback ? (left[0] ?? "") : config.defaultModel,
    });
  }

  /**
   * The default is the model named, and nothing else: the list stays where it
   * is, since the picker's order is the user's and choosing what a new chat
   * starts from is not a way of reordering it.
   */
  function makeDefault(id: string) {
    onChange({ defaultModel: id });
  }

  /** Rewrites one gateway in place: its key, or where it is. */
  function changeGateway(id: string, patch: Partial<Gateway>) {
    onChange({ gateways: gateways.map((g) => (g.id === id ? { ...g, ...patch } : g)) });
  }

  /** The provider the screen set: what the app's own models are asked of. */
  function addProvider(provider: string, endpoint: string, apiKey: string, first: string) {
    onChange({ provider, endpoint, apiKey, models: [...models, first] });
    setJustAdded(first);
    setChosen(OWN);
  }

  return (
    <div className="settings models">
      <div className="models-head">
        <h2 className="models-title">Models</h2>
        <p className="models-subtitle">
          The models the chat picker offers. Every chat keeps the model it was started with.
        </p>
      </div>

      <div className="models-default">
        <span className="models-default-label">Default for new chats</span>
        <div className="models-default-value">
          <select
            className="models-default-select"
            value={fallback}
            disabled={models.length === 0}
            aria-label="Default for new chats"
            onChange={(e) => makeDefault(e.target.value)}
          >
            {models.length === 0 && <option value="">None yet</option>}
            {models.map((id) => (
              <option key={id} value={id}>
                {nameOf(id, gateways)} — {label(gatewayOf(id, gateways))}
              </option>
            ))}
          </select>
          <ChevronDown className="models-default-chevron" aria-hidden="true" />
        </div>
      </div>

      <div className="models-tabs" role="tablist" aria-label="Gateways">
        {tabs.map((id) => (
          <button
            key={id || "own"}
            role="tab"
            aria-selected={open === id}
            className="models-tab"
            onClick={() => setChosen(id)}
          >
            {label(id)}
            <span className="models-tab-count">{held(id).length}</span>
          </button>
        ))}
        <button
          role="tab"
          aria-selected={open === NEW}
          className="models-tab models-tab-add"
          onClick={() => setChosen(NEW)}
        >
          <Plus />
          Add provider
        </button>
      </div>

      {open === NEW ? (
        <NewProvider
          models={models}
          gateways={gateways}
          provider={config.provider}
          apiKey={config.apiKey}
          endpoint={config.endpoint}
          onAdd={addProvider}
        />
      ) : (
        <div className="models-panel" role="tabpanel">
          {gateway ? (
            <>
              <Field label="API Key">
                <SecretInput
                  value={gateway.apiKey}
                  label="API Key"
                  onChange={(apiKey) => changeGateway(gateway.id, { apiKey })}
                />
              </Field>
              {/* Where the name is one the app does not hold a URL for, the
                  endpoint is the page's business: nothing else knows it. A name
                  it does hold — OpenRouter's, OpenAI's, Google's and the rest —
                  needs no line here at all, since the name is the URL. */}
              {!KNOWN.includes(gateway.id) && (
                <Field label="Endpoint">
                  <input
                    type="text"
                    className="input"
                    value={gateway.endpoint}
                    placeholder="https://example.com/v1"
                    spellCheck={false}
                    onChange={(e) => changeGateway(gateway.id, { endpoint: e.target.value })}
                  />
                </Field>
              )}
            </>
          ) : (
            <>
              {/* What the app's own provider is, and where — an OpenAI-compatible
                  endpoint is a URL and nothing else knows it, while OpenRouter's
                  name is its address. Which of the two it is is chosen on the Add
                  provider screen rather than here: one place decides it, and this
                  is where its key and its address are read and corrected. */}
              {config.provider === "custom" && (
                <Field label="Endpoint">
                  <input
                    type="text"
                    className="input"
                    value={config.endpoint}
                    placeholder="https://example.com/v1"
                    spellCheck={false}
                    onChange={(e) => onChange({ endpoint: e.target.value })}
                  />
                </Field>
              )}
              <Field label="API Key">
                <SecretInput
                  value={config.apiKey}
                  label="API Key"
                  onChange={(apiKey) => onChange({ apiKey })}
                />
              </Field>
            </>
          )}

          <AddModel tab={open} gateway={gateway?.id ?? own} models={models} gateways={gateways} onAdd={add} />

          <ul className="models-list">
            {held(open).map((id) => (
              <ModelRow
                key={id}
                id={id}
                name={nameOf(id, gateways)}
                isDefault={id === fallback}
                isLast={models.length === 1}
                fresh={id === justAdded}
                onRemove={() => remove(id)}
              />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * One model: its name, the id a request carries, and the way it goes.
 *
 * Which model a chat starts from is the default row's business rather than this
 * row's, so the row says where it stands — the `Default` badge — and offers only
 * the one thing to do to it. The last model of the app has no bin: a chat needs
 * something to ask, so the row says why instead.
 */
function ModelRow({
  id,
  name,
  isDefault,
  isLast,
  fresh,
  onRemove,
}: {
  id: string;
  /** Its own name under its gateway, which may be the id itself. */
  name: string;
  isDefault: boolean;
  isLast: boolean;
  /** Written by the add that put it there, marked until the next one. */
  fresh: boolean;
  onRemove: () => void;
}) {
  const { asking, ask, giveUp } = useDeleteQuestion();

  return (
    <li className={`models-row row${asking ? " confirming" : ""}${fresh && !asking ? " fresh" : ""}`}>
      <span className="models-row-text">
        <span className="models-row-name">
          {asking ? "Remove this model?" : name}
          {!asking && isDefault && <span className="models-badge">Default</span>}
          {!asking && fresh && <span className="models-badge added">Added</span>}
        </span>
        {/* The id is what a request carries and what the picker shows, so it is
            read under the name rather than instead of it — and it stays there
            while the question is up, since it is what is about to go. Where the
            gateway's name already leads the model's own name it says nothing the
            line above has not, so it is left out. */}
        {name !== id && <span className="models-row-id">{id}</span>}
      </span>
      {isLast ? (
        <span className="models-row-keep" title="The picker needs at least one model">
          Last model
        </span>
      ) : (
        <RowDelete
          asking={asking}
          label={`Remove ${id}`}
          ask={ask}
          giveUp={giveUp}
          onDelete={onRemove}
        />
      )}
    </li>
  );
}

/**
 * The field that starts a tab's list: the id of one of the gateway's models,
 * written whole — the gateway's name, a slash, the name that gateway knows the
 * model by — which is what the field's own example shows. A name typed without
 * the gateway's word before it is read with it, so the common case is the short
 * one.
 *
 * It stands above the list rather than under it, so the list is read from its
 * head — the default — down, with nothing to add between the reader and it.
 */
function AddModel({
  tab,
  gateway,
  models,
  gateways,
  onAdd,
}: {
  /** The tab the field adds to: its name is the prefix, or `OWN` for none. */
  tab: string;
  /** The name the example is chosen by, which is the tab's own. */
  gateway: string;
  models: string[];
  gateways: Gateway[];
  onAdd: (id: string) => void;
}) {
  const [written, setWritten] = useState("");
  const typed = written.trim();
  const prefix = tab === OWN ? "" : tab + "/";
  // What is typed is the model's own name unless it already carries a gateway's:
  // the field is asked for an id, and an id it is given either way.
  const id = typed === "" || prefix === "" || typed.includes("/") ? typed : prefix + typed;
  const clash = tab === OWN ? ownProblem(id, gateways) : "";
  const why = clash || problem(id, models);
  const ready = typed !== "" && why === "";

  function submit() {
    if (!ready) return;
    onAdd(id);
    setWritten("");
  }

  return (
    <div className="models-add">
      <span className="field-label">Add Model</span>
      <div className="models-add-row">
        <input
          type="text"
          className="input models-add-input"
          value={written}
          placeholder={prefix + (EXAMPLES[gateway] ?? "model-name")}
          spellCheck={false}
          aria-label={`New ${gatewayName(gateway)} model`}
          onChange={(e) => setWritten(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
        <button className="btn btn--primary models-add-button" onClick={submit} disabled={!ready}>
          Add
        </button>
      </div>
      {why && <p className="settings-note models-error">{why}</p>}
    </div>
  );
}

/**
 * The screen that starts the app's provider: which of the two it is, where it
 * is, what it is asked with, and the first model it is asked for.
 *
 * The provider is chosen rather than written: pressing one of the two pills
 * shows its fields, so what a reader is asked for is what the thing they chose
 * needs — a URL for an endpoint of their own, nothing for OpenRouter, whose
 * address the app knows. The models the provider serves are the ones whose ids
 * name no gateway, which is the app's own tab, so pressing the button lands
 * there. The line above the button says what pressing it would write before it
 * is pressed.
 *
 * A provider that is already the app's own is not started a second time: the
 * screen opens on what the app is asked with now, and its arrangement is one
 * thing rather than a list of them, so the line above the button says where what
 * it holds is read — on the tab it already has. Only an OpenAI-compatible
 * endpoint is offered again and again, since the reader may be pointing the app
 * somewhere else entirely under the same name.
 */
function NewProvider({
  models,
  gateways,
  provider,
  apiKey,
  endpoint,
  onAdd,
}: {
  models: string[];
  gateways: Gateway[];
  /** The app's provider now, which is what the screen opens on. */
  provider: string;
  apiKey: string;
  endpoint: string;
  onAdd: (provider: string, endpoint: string, apiKey: string, first: string) => void;
}) {
  const [id, setId] = useState(provider);
  const [where, setWhere] = useState(endpoint);
  const [key, setKey] = useState(apiKey);
  const [name, setName] = useState("");

  const first = name.trim();
  // What is already the app's own is not added again: it is one arrangement
  // rather than a list entry, and what it holds is read on its own tab. An
  // OpenAI-compatible endpoint is the exception — the same word, pointed
  // somewhere the reader may have changed.
  const begun =
    id !== "custom" && id === provider
      ? `${gatewayName(id)} is already set up: its key and its models are on its own tab.`
      : "";
  const why = begun || (first === "" ? "" : ownProblem(first, gateways) || problem(first, models));
  const ready = first !== "" && why === "";
  const add = () => onAdd(id, where.trim(), key, first);

  return (
    <div className="models-panel" role="tabpanel">
      <div className="models-suggest">
        {PROVIDERS.map((p) => (
          <button
            key={p}
            className="btn btn--pill"
            aria-pressed={id === p}
            onClick={() => setId(p)}
          >
            {gatewayName(p)}
          </button>
        ))}
      </div>

      {/* The one field that is the provider's own rather than the form's: an
          OpenAI-compatible endpoint is wherever its reader put it, and this is
          where they say where. */}
      {id === "custom" && (
        <Field label="Endpoint">
          <input
            type="text"
            className="input"
            value={where}
            placeholder="https://example.com/v1"
            spellCheck={false}
            onChange={(e) => setWhere(e.target.value)}
          />
        </Field>
      )}

      <Field label="First model">
        <input
          type="text"
          className="input models-add-input"
          value={name}
          placeholder={FIRST_EXAMPLES[id] ?? "model-name"}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ready && add()}
        />
      </Field>

      <Field label="API Key">
        <SecretInput value={key} onChange={setKey} label="API Key" />
      </Field>

      <div className="models-adds">
        {/* What the button would write, before it is pressed — and why it will
            not, where something is in the way. Nothing stands there while there
            is nothing to say. */}
        <span className={`models-preview${why ? " models-error" : ""}`}>
          {why || (ready ? <>Adds <code>{first}</code></> : null)}
        </span>
        <button className="btn btn--primary" onClick={add} disabled={!ready}>
          Add provider
        </button>
      </div>
    </div>
  );
}
