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
    /// The models to choose between, in the order the picker shows them. The
    /// first is what a chat starts from when the history has nothing to say;
    /// a chat then keeps whichever it was given.
    pub models: Vec<String>,
    /// Sent ahead of every chat as a `system` message. It belongs to the
    /// request rather than to the transcript, so no chat ever stores it.
    #[serde(default)]
    pub system_prompt: String,
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
    pub system_prompt: String,
}

impl From<&Settings> for AppConfig {
    fn from(settings: &Settings) -> Self {
        AppConfig {
            name: settings.name.clone(),
            provider: settings.provider.clone(),
            endpoint: settings.endpoint.clone(),
            api_key: settings.api_key.clone(),
            models: settings.models.clone(),
            system_prompt: settings.system_prompt.clone(),
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
            system_prompt: config.system_prompt.clone(),
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
    /// Absent from every file written before the prompt existed, which is an
    /// empty prompt rather than a file that cannot be read.
    #[serde(default)]
    system_prompt: String,
}

/// The endpoint a gateway's name stood for, back when the provider was written
/// as a name and translated here. Anything else — an unknown name, or the
/// endpoint itself — is `None`, and is read as what it already looks like.
fn known(name: &str) -> Option<&'static str> {
    match name {
        "openrouter" => Some(OPENROUTER_URL),
        "openai" => Some("https://api.openai.com/v1"),
        "deepseek" => Some("https://api.deepseek.com/v1"),
        "groq" => Some("https://api.groq.com/openai/v1"),
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
            None if name.trim_end_matches('/') == OPENROUTER_URL => (OPENROUTER.into(), String::new()),
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
        let (provider, endpoint) = provider_from(&raw.provider, raw.endpoint);
        Settings {
            name: raw.name,
            provider,
            endpoint,
            api_key: raw.api_key,
            models,
            system_prompt: raw.system_prompt,
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
        system_prompt: String::new(),
    }
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

#[cfg(test)]
#[path = "tests/settings.rs"]
mod tests;

