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
    pub provider: String,
    pub endpoint: String,
    pub api_key: String,
    pub models: Vec<String>,
    pub system_prompt: String,
}

impl From<&Settings> for AppConfig {
    fn from(settings: &Settings) -> Self {
        AppConfig {
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
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!(
            "chalk-settings-{name}-{}.yaml",
            std::process::id()
        ));
        let _ = std::fs::remove_file(&path);
        path
    }

    #[test]
    fn settings_round_trip_through_a_file() {
        let path = temp("round-trip");
        let settings = Settings {
            provider: CUSTOM.into(),
            endpoint: "https://api.groq.com/openai/v1".into(),
            api_key: "sk-1".into(),
            models: vec!["llama-3.3-70b".into(), "mixtral-8x7b".into()],
            system_prompt: "Answer in one line.".into(),
        };
        write_to(&path, &settings).unwrap();
        assert_eq!(read(&path).unwrap(), settings);
        let _ = std::fs::remove_file(&path);
    }

    /// The shape this file had before models were a list: one `model` key, which
    /// has to become a list of one rather than being lost.
    #[test]
    fn an_old_file_with_a_single_model_reads_as_a_list_of_one() {
        let path = temp("old-model-key");
        std::fs::write(
            &path,
            "provider: openrouter\napi_key: sk-1\nmodel: some/old-model\n",
        )
        .unwrap();
        let settings = read(&path).unwrap();
        assert_eq!(settings.models, vec!["some/old-model".to_string()]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn a_blank_row_is_not_a_model() {
        let path = temp("blank-row");
        std::fs::write(
            &path,
            "provider: openrouter\napi_key: sk-1\nmodels:\n  - \"\"\n  - real/model\n  - \"  \"\n",
        )
        .unwrap();
        assert_eq!(read(&path).unwrap().models, vec!["real/model".to_string()]);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn an_empty_model_list_falls_back_to_the_default() {
        let path = temp("no-models");
        std::fs::write(&path, "provider: openrouter\napi_key: sk-1\nmodels: []\n").unwrap();
        assert_eq!(read(&path).unwrap().models, defaults().models);
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(unix)]
    #[test]
    fn the_settings_file_is_the_owner_s_alone_to_read() {
        use std::os::unix::fs::PermissionsExt;

        let path = temp("permissions");
        write_to(&path, &defaults()).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
        let _ = std::fs::remove_file(&path);
    }

    #[cfg(unix)]
    #[test]
    fn a_directory_it_makes_is_private() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir().join(format!("chalk-settings-dir-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        write_to(&dir.join(FILE), &defaults()).unwrap();
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// The rule that keeps a save from making somewhere like `/tmp` private.
    #[cfg(unix)]
    #[test]
    fn a_directory_it_did_not_make_keeps_its_mode() {
        use std::os::unix::fs::PermissionsExt;

        let dir = std::env::temp_dir();
        let before = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        write_to(&temp("existing-dir"), &defaults()).unwrap();
        let after = std::fs::metadata(&dir).unwrap().permissions().mode() & 0o777;
        assert_eq!(after, before);
    }

    #[test]
    fn the_file_is_the_one_under_the_home_directory() {
        assert_eq!(
            path_in(Path::new("/home/someone")),
            PathBuf::from("/home/someone/.chalk/settings.yaml")
        );
    }

    #[test]
    fn a_hand_edited_file_parses_with_comments_and_unknown_keys() {
        let path = temp("hand-edited");
        std::fs::write(
            &path,
            "# where the requests go\nprovider: openai\napi_key: 'sk-quoted'\nmodels:\n  - gpt-4o\n  - o3-mini\nsomething_else: 2\n",
        )
        .unwrap();
        let settings = read(&path).unwrap();
        // A gateway this file no longer names: it is read as the endpoint it
        // stood for, under the custom provider the selector offers.
        assert_eq!(settings.provider, CUSTOM);
        assert_eq!(settings.endpoint, "https://api.openai.com/v1");
        assert_eq!(settings.api_key, "sk-quoted");
        assert_eq!(settings.models, vec!["gpt-4o".to_string(), "o3-mini".into()]);
        // The prompt was not a key when this file was written; no prompt is the
        // only thing it can mean.
        assert_eq!(settings.system_prompt, "");
        let _ = std::fs::remove_file(&path);
    }

    /// The file most of these were left in: the endpoint written out by hand,
    /// which is OpenRouter's own. It is OpenRouter rather than a custom provider
    /// pointing at the same URL, because that is what turns its cache on.
    #[test]
    fn openrouters_own_endpoint_is_read_as_openrouter() {
        let path = temp("openrouter-url");
        std::fs::write(
            &path,
            "provider: https://openrouter.ai/api/v1\napi_key: sk-1\nmodels:\n  - some/model\n",
        )
        .unwrap();
        let settings = read(&path).unwrap();
        assert_eq!(settings.provider, OPENROUTER);
        assert_eq!(settings.endpoint, "");
        let _ = std::fs::remove_file(&path);
    }

    /// A file the selector wrote: both names keep what they were given.
    #[test]
    fn the_two_names_survive_a_round_trip() {
        assert_eq!(provider_from(CUSTOM, "http://localhost:8080/v1".into()), (CUSTOM.into(), "http://localhost:8080/v1".into()));
        assert_eq!(provider_from(OPENROUTER, "ignored".into()), (OPENROUTER.into(), String::new()));
        // A file with no provider at all is the app's own default.
        assert_eq!(provider_from("", String::new()), (OPENROUTER.into(), String::new()));
    }

    /// Nobody's file named this, and it is not an endpoint: it is passed
    /// through as written, so a typo reads back as the typo it is.
    #[test]
    fn an_unknown_name_is_taken_as_an_endpoint() {
        assert_eq!(
            provider_from("my-gateway", String::new()),
            (CUSTOM.into(), "my-gateway".into())
        );
    }

    #[test]
    fn the_endpoint_is_the_one_the_provider_names() {
        assert_eq!(endpoint(OPENROUTER, ""), OPENROUTER_URL);
        assert_eq!(endpoint(CUSTOM, " https://example.com/v1 "), "https://example.com/v1");
        // A custom provider with nothing written in its field is an endpoint of
        // nothing: the request fails and says so, rather than being sent to a
        // URL nobody chose.
        assert_eq!(endpoint(CUSTOM, ""), "");
    }

    #[test]
    fn the_config_crosses_to_the_frontend_in_its_own_spelling() {
        let settings = Settings {
            provider: OPENROUTER.into(),
            endpoint: String::new(),
            api_key: "sk-1".into(),
            models: vec!["some/model".into()],
            system_prompt: "Be brief.".into(),
        };
        let config = AppConfig::from(&settings);
        assert_eq!(
            serde_json::to_string(&config).unwrap(),
            r#"{"provider":"openrouter","endpoint":"","apiKey":"sk-1","models":["some/model"],"systemPrompt":"Be brief."}"#
        );
        assert_eq!(Settings::from(&config), settings);
    }
}
