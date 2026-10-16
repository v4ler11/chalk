//! The user's settings: `~/.chalk/settings.yaml` — where requests go, the key
//! they are sent with, and the model to ask for.
//!
//! The file is meant to be edited by hand, so it holds what was written rather
//! than what was resolved: the provider is one of two names, not the endpoint
//! OpenRouter's stands for. A rewrite loses comments and unknown keys, which is
//! the price of the file being generated from these fields.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// The settings directory, under the user's home directory.
const DIR: &str = ".chalk";
/// The settings file within it.
const FILE: &str = "settings.yaml";

/// OpenRouter, as the settings name it. It is more than one endpoint to this
/// app: it is the gateway whose response cache is asked for on every request,
/// and whose own word on a response — its cache, its prices — is read back.
pub const OPENROUTER: &str = "openrouter";
/// Anything else: an OpenAI-compatible endpoint, named by [`Settings::endpoint`].
pub const CUSTOM: &str = "custom";
/// Where OpenRouter's name resolves to.
pub const OPENROUTER_URL: &str = "https://openrouter.ai/api/v1";

/// A gateway a model can be asked of by name: a model whose id begins with the
/// gateway's own name is sent to it, with the key kept here rather than the
/// app's own. It is what lets one app talk to several providers at once — the
/// picker's models can each name the gateway that serves them.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub struct Gateway {
    /// The gateway's own name, and the prefix its models' ids carry.
    pub id: String,
    /// Where it is, when the name is not one the app knows. Written out to the
    /// file as it was written in: empty for a name that resolves here.
    #[serde(default)]
    pub endpoint: String,
    pub api_key: String,
}

/// The settings as the file holds them: the keys are the file's keys.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
pub struct Settings {
    /// What the channel calls the person using it: their own words, drawn
    /// beside what they post. Nothing in the app needs it to work, so a file
    /// without one is a file that was written before there was anywhere to put
    /// it, and reads as nothing at all.
    #[serde(default)]
    pub name: String,
    /// Where requests go: [`OPENROUTER`], or [`CUSTOM`].
    pub provider: String,
    /// Where a custom provider is: the base URL of an OpenAI-compatible API,
    /// with the paths this app calls — `/chat/completions` — hung off it. Not
    /// read while the provider is OpenRouter, which has an endpoint of its own.
    #[serde(default)]
    pub endpoint: String,
    pub api_key: String,
    /// The models to choose between, in the order the picker shows them. A chat
    /// keeps whichever it was given for as long as it lives.
    pub models: Vec<String>,
    /// What a new chat starts from, when the history has nothing to say. It is
    /// a model's id rather than a place in the list: choosing a default is not
    /// a way of reordering the picker, and a default is not forgotten by adding
    /// a model above it. Absent from every file written before it was a key,
    /// and empty or naming a model the list no longer holds, both of which are
    /// read as the head of the list.
    #[serde(default)]
    pub default_model: String,
    /// Sent ahead of every chat as a `system` message. It belongs to the
    /// request rather than to the transcript, so no chat ever stores it.
    #[serde(default)]
    pub system_prompt: String,
    /// The gateways a model can be asked of by naming one in its id. Absent
    /// from every file written before they existed, which is no gateways
    /// rather than a file that cannot be read.
    #[serde(default)]
    pub gateways: Vec<Gateway>,
}

/// The settings as the frontend sees them: camelCase over the wire, the file's
/// own spelling only on disk.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub name: String,
    pub provider: String,
    pub endpoint: String,
    pub api_key: String,
    pub models: Vec<String>,
    pub default_model: String,
    pub system_prompt: String,
    pub gateways: Vec<AppGateway>,
}

/// A gateway as the frontend sees it: the same fields as the file's, spelled the
/// way every other setting is on the wire.
#[derive(Serialize, Deserialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppGateway {
    pub id: String,
    pub endpoint: String,
    pub api_key: String,
}

impl From<&Gateway> for AppGateway {
    fn from(gateway: &Gateway) -> Self {
        AppGateway {
            id: gateway.id.clone(),
            endpoint: gateway.endpoint.clone(),
            api_key: gateway.api_key.clone(),
        }
    }
}

impl From<&AppGateway> for Gateway {
    fn from(gateway: &AppGateway) -> Self {
        Gateway {
            id: gateway.id.clone(),
            endpoint: gateway.endpoint.clone(),
            api_key: gateway.api_key.clone(),
        }
    }
}

impl From<&Settings> for AppConfig {
    fn from(settings: &Settings) -> Self {
        AppConfig {
            name: settings.name.clone(),
            provider: settings.provider.clone(),
            endpoint: settings.endpoint.clone(),
            api_key: settings.api_key.clone(),
            models: settings.models.clone(),
            default_model: settings.default_model.clone(),
            system_prompt: settings.system_prompt.clone(),
            gateways: settings.gateways.iter().map(AppGateway::from).collect(),
        }
    }
}

impl From<&AppConfig> for Settings {
    fn from(config: &AppConfig) -> Self {
        Settings {
            name: config.name.clone(),
            provider: config.provider.clone(),
            endpoint: config.endpoint.clone(),
            api_key: config.api_key.clone(),
            models: config.models.clone(),
            default_model: config.default_model.clone(),
            system_prompt: config.system_prompt.clone(),
            gateways: config.gateways.iter().map(Gateway::from).collect(),
        }
    }
}

/// What the file may hold. The models are a list here, but the first version of
/// the file had a single `model`, so both keys are read: the old one becomes a
/// list of one, and only the list is ever written back. The provider, too, was
/// written in a shape this file no longer has — see [`provider_from`].
#[derive(Deserialize)]
struct Raw {
    /// Absent from every file written before there was a name to hold, which is
    /// no name rather than a file that cannot be read.
    #[serde(default)]
    name: String,
    #[serde(default)]
    provider: String,
    #[serde(default)]
    endpoint: String,
    api_key: String,
    #[serde(default)]
    models: Vec<String>,
    #[serde(default)]
    model: Option<String>,
    /// Absent from every file written before the default was a key, which is the
    /// head of the list rather than a file that cannot be read.
    #[serde(default)]
    default_model: String,
    /// Absent from every file written before the prompt existed, which is an
    /// empty prompt rather than a file that cannot be read.
    #[serde(default)]
    system_prompt: String,
    /// Absent from every file written before gateways existed, which is none.
    #[serde(default)]
    gateways: Vec<Gateway>,
}

/// The endpoint a gateway's name stood for, back when the provider was written
/// as a name and translated here. Anything else — an unknown name, or the
/// endpoint itself — is `None`, and is read as what it already looks like.
///
/// Every URL is the root its `/chat/completions` hangs off, which is what makes
/// a name enough: a gateway named `google` is asked for where Google's
/// OpenAI-compatible API is, with nothing written out for it. Anthropic is not
/// among them — its own API is not shaped like this one — so a gateway named
/// `anthropic` needs the endpoint of whatever speaks for it.
fn known(name: &str) -> Option<&'static str> {
    match name {
        "openrouter" => Some(OPENROUTER_URL),
        "openai" => Some("https://api.openai.com/v1"),
        "google" => Some("https://generativelanguage.googleapis.com/v1beta/openai"),
        "deepseek" => Some("https://api.deepseek.com/v1"),
        "groq" => Some("https://api.groq.com/openai/v1"),
        "mistral" => Some("https://api.mistral.ai/v1"),
        "xai" => Some("https://api.x.ai/v1"),
        "ollama" => Some("http://localhost:11434/v1"),
        "lmstudio" => Some("http://localhost:1234/v1"),
        _ => None,
    }
}

/// Reads the provider a file was written with as the two names this app now
/// offers. Older files named a gateway, or wrote the endpoint itself: a name
/// that resolves to OpenRouter is OpenRouter — the URL is the same either way,
/// and the difference is what the app does with it — and everything else is a
/// custom endpoint. A file written by the selector is already one of the two.
pub fn provider_from(written: &str, endpoint: String) -> (String, String) {
    match written.trim() {
        "" => (OPENROUTER.into(), String::new()),
        CUSTOM => (CUSTOM.into(), endpoint),
        name => match known(name) {
            Some(OPENROUTER_URL) => (OPENROUTER.into(), String::new()),
            Some(url) => (CUSTOM.into(), url.to_string()),
            // The endpoint written out by hand rather than named: the same URL
            // as OpenRouter's, and so the same provider. Which one it is decides
            // what the app asks for — the response cache — and what it reads
            // back, so a URL that is OpenRouter's is not left as a custom
            // provider merely because it was spelled out.
            None if is_openrouter_url(name) => (OPENROUTER.into(), String::new()),
            None => (CUSTOM.into(), name.to_string()),
        },
    }
}

impl From<Raw> for Settings {
    fn from(raw: Raw) -> Self {
        // A row someone left empty is not a model, so it is dropped here rather
        // than offered in the picker and sent to a provider.
        let mut models: Vec<String> = raw
            .models
            .into_iter()
            .filter(|m| !m.trim().is_empty())
            .collect();
        if models.is_empty() {
            if let Some(one) = raw.model.filter(|m| !m.trim().is_empty()) {
                models.push(one);
            }
        }
        // A file with neither, or with an empty list, is not a file without a
        // model: everything downstream can then take the list as given.
        if models.is_empty() {
            models = defaults().models;
        }
        // What a new chat starts from: the model the file names, if the list
        // still holds it. Anything else — a file written before the key
        // existed, or a default removed from the list by hand — is the head of
        // the list, so nothing downstream is ever handed a default it cannot
        // ask a provider for.
        let default_model = models
            .iter()
            .find(|model| model.trim() == raw.default_model.trim())
            .cloned()
            .unwrap_or_else(|| models.first().cloned().unwrap_or_default());
        let (provider, endpoint) = provider_from(&raw.provider, raw.endpoint);
        Settings {
            name: raw.name,
            provider,
            endpoint,
            api_key: raw.api_key,
            models,
            default_model,
            system_prompt: raw.system_prompt,
            gateways: raw.gateways,
        }
    }
}

/// The settings file, under the given home directory.
pub fn path_in(home: &Path) -> PathBuf {
    home.join(DIR).join(FILE)
}

/// The settings file, under the current user's home directory.
pub fn path() -> Result<PathBuf, String> {
    let home = std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .ok_or_else(|| "no home directory to keep settings in".to_string())?;
    Ok(path_in(Path::new(&home)))
}

/// Reads the settings, writing the defaults out if there is no file yet.
pub fn load() -> Result<Settings, String> {
    let path = path()?;
    if path.exists() {
        read(&path)
    } else {
        let settings = defaults();
        write_to(&path, &settings)?;
        Ok(settings)
    }
}

/// Reads the settings at `path`.
pub fn read(path: &Path) -> Result<Settings, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let parsed: Raw = serde_norway::from_str(&raw).map_err(|e| format!("{}: {e}", path.display()))?;
    Ok(Settings::from(parsed))
}

/// Writes the settings to `path`, making its directory if it is not there.
///
/// The file holds a bearer key, so it is kept for its owner to read: the
/// directory is made private when it is made at all (never when it already
/// exists, which may be somewhere like `/tmp`), and the file is closed to
/// everyone else. A refused `chmod` is not worth failing a save over.
pub fn write_to(path: &Path, settings: &Settings) -> Result<(), String> {
    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;

    if let Some(dir) = path.parent() {
        if !dir.exists() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
            #[cfg(unix)]
            let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
        }
    }
    let raw = serde_norway::to_string(settings).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    Ok(())
}

/// What a first run starts with.
pub fn defaults() -> Settings {
    Settings {
        // Nobody has said who they are yet, and the app does not need to know:
        // the channel draws "You" until they write their name in.
        name: String::new(),
        provider: OPENROUTER.into(),
        endpoint: String::new(),
        // No key ships with the app: the file is the user's, and the key in it
        // is theirs to put there, from Settings or by hand. A request without
        // one is refused by the provider, which is the honest answer.
        api_key: String::new(),
        models: vec!["deepseek/deepseek-v4.1-flash".into()],
        // The same model, named as the default: one model's worth of chat, which
        // is what a first run has to ask with.
        default_model: "deepseek/deepseek-v4.1-flash".into(),
        system_prompt: String::new(),
        // No gateway ships with the app: a model is asked of the app's own
        // provider until the user names one.
        gateways: Vec::new(),
    }
}

/// What a new chat starts from, when the history has nothing to say: the model
/// the settings name, or the head of the list.
///
/// The named one is taken only while the list still holds it, so a default left
/// behind by a removal falls to the list itself rather than being asked of a
/// provider that does not serve it. A list with nothing in it — which only a
/// file edited by hand can be — is no model at all, and the empty string is what
/// every reader of this already does with that.
pub fn default_model(config: &AppConfig) -> &str {
    let named = config.default_model.trim();
    if !named.is_empty() {
        if let Some(known) = config.models.iter().find(|model| model.trim() == named) {
            return known;
        }
    }
    config
        .models
        .iter()
        .find(|model| !model.trim().is_empty())
        .map(String::as_str)
        .unwrap_or("")
}

/// The endpoint requests go to: the one a custom provider names, or the one
/// OpenRouter's name stands for. Anything that is not [`CUSTOM`] is read as
/// OpenRouter — a file naming something this app has never heard of is still
/// the app's own default, which is the one endpoint it knows.
pub fn endpoint<'a>(provider: &str, endpoint: &'a str) -> &'a str {
    if provider.trim() == CUSTOM {
        endpoint.trim()
    } else {
        OPENROUTER_URL
    }
}

/// Where a gateway's requests go: the endpoint it wrote out, the one the app
/// knows its name for, or — for a name it has never heard of, and that wrote no
/// endpoint — the app's own provider, which is the one place left to send to
/// rather than an empty URL.
fn gateway_url(config: &AppConfig, gateway: &AppGateway) -> String {
    let written = gateway.endpoint.trim();
    if !written.is_empty() {
        return written.to_string();
    }
    match known(gateway.id.trim()) {
        Some(url) => url.to_string(),
        None => endpoint(&config.provider, &config.endpoint).to_string(),
    }
}

/// The gateway a model is asked of: the one its id's first segment names, or the
/// app's own provider when that segment names no gateway it has.
///
/// A model's id leads with the gateway that serves it — `anthropic/claude-…` is
/// Anthropic's model as whoever routes it spells it — so the first segment is
/// read as a gateway's name. A segment that names no gateway the app has is not
/// a gateway: OpenRouter's own vendor-prefixed ids look the same, and they are
/// the app's own provider's to route, as is a model with no prefix at all.
///
/// What comes back is the name, the URL its `/chat/completions` hangs off, and
/// the key the request is sent with — the whole of what a request needs to go to
/// the right place under the right credentials.
pub fn gateway_for<'a>(config: &'a AppConfig, model: &str) -> (String, String, &'a str) {
    let segment = model
        .split_once('/')
        .map(|(segment, _)| segment)
        .filter(|segment| !segment.is_empty());
    if let Some(segment) = segment {
        if let Some(gateway) = config.gateways.iter().find(|g| g.id.trim() == segment) {
            return (
                gateway.id.clone(),
                gateway_url(config, gateway),
                gateway.api_key.as_str(),
            );
        }
    }
    (
        config.provider.clone(),
        endpoint(&config.provider, &config.endpoint).to_string(),
        config.api_key.as_str(),
    )
}

/// Whether a URL is OpenRouter's — the one gateway whose response cache this app
/// asks for and whose own word on a response it reads back.
pub fn is_openrouter_url(url: &str) -> bool {
    url.trim_end_matches('/') == OPENROUTER_URL
}

#[cfg(test)]
#[path = "tests/settings.rs"]
mod tests;

