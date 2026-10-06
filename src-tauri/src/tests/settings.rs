//! The tests that were written inside `settings.rs`.
//!
//! They are a child module of it still (`#[path]` keeps `super` pointing at the
//! same place), so they see its private items exactly as they did inline; the
//! file is separate only so that a source file is a source.

use super::*;

fn temp(name: &str) -> PathBuf {
    let path =
        std::env::temp_dir().join(format!("chalk-settings-{name}-{}.yaml", std::process::id()));
    let _ = std::fs::remove_file(&path);
    path
}

#[test]
fn settings_round_trip_through_a_file() {
    let path = temp("round-trip");
    let settings = Settings {
        name: "Valerii".into(),
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
    assert_eq!(
        settings.models,
        vec!["gpt-4o".to_string(), "o3-mini".into()]
    );
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
    assert_eq!(
        provider_from(CUSTOM, "http://localhost:8080/v1".into()),
        (CUSTOM.into(), "http://localhost:8080/v1".into())
    );
    assert_eq!(
        provider_from(OPENROUTER, "ignored".into()),
        (OPENROUTER.into(), String::new())
    );
    // A file with no provider at all is the app's own default.
    assert_eq!(
        provider_from("", String::new()),
        (OPENROUTER.into(), String::new())
    );
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
    assert_eq!(
        endpoint(CUSTOM, " https://example.com/v1 "),
        "https://example.com/v1"
    );
    // A custom provider with nothing written in its field is an endpoint of
    // nothing: the request fails and says so, rather than being sent to a
    // URL nobody chose.
    assert_eq!(endpoint(CUSTOM, ""), "");
}

#[test]
fn the_config_crosses_to_the_frontend_in_its_own_spelling() {
    let settings = Settings {
        name: "Valerii".into(),
        provider: OPENROUTER.into(),
        endpoint: String::new(),
        api_key: "sk-1".into(),
        models: vec!["some/model".into()],
        system_prompt: "Be brief.".into(),
    };
    let config = AppConfig::from(&settings);
    assert_eq!(
        serde_json::to_string(&config).unwrap(),
        r#"{"name":"Valerii","provider":"openrouter","endpoint":"","apiKey":"sk-1","models":["some/model"],"systemPrompt":"Be brief."}"#
    );
    assert_eq!(Settings::from(&config), settings);
}
