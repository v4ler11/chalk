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
        default_model: "mixtral-8x7b".into(),
        system_prompt: "Answer in one line.".into(),
        gateways: Vec::new(),
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

/// The model a new chat starts from is a key of its own, and a file written
/// before it existed is read as the head of the list — the answer the app gave
/// when the head was all it had.
#[test]
fn a_file_without_a_default_reads_as_the_head_of_the_list() {
    let path = temp("no-default");
    std::fs::write(
        &path,
        "provider: openrouter\napi_key: sk-1\nmodels:\n  - a/one\n  - b/two\n",
    )
    .unwrap();
    let settings = read(&path).unwrap();
    assert_eq!(settings.default_model, "a/one");
    let config = AppConfig::from(&settings);
    assert_eq!(default_model(&config), "a/one");
    let _ = std::fs::remove_file(&path);
}

/// A default is a model, not a place: the list keeps the order it was written
/// in, and the default is the model named wherever it stands in it.
#[test]
fn a_default_is_the_model_named_rather_than_the_head_of_the_list() {
    let path = temp("default-named");
    std::fs::write(
        &path,
        "provider: openrouter\napi_key: sk-1\nmodels:\n  - a/one\n  - b/two\ndefault_model: b/two\n",
    )
    .unwrap();
    let settings = read(&path).unwrap();
    assert_eq!(settings.models, vec!["a/one".to_string(), "b/two".into()]);
    assert_eq!(default_model(&AppConfig::from(&settings)), "b/two");
    let _ = std::fs::remove_file(&path);
}

/// A default left behind by a removal — by hand in the file, or by a save the
/// app made before it could know better — falls to the head of the list rather
/// than being asked of a provider that does not serve it.
#[test]
fn a_default_that_is_not_in_the_list_is_the_head() {
    let path = temp("default-gone");
    std::fs::write(
        &path,
        "provider: openrouter\napi_key: sk-1\nmodels:\n  - a/one\n  - b/two\ndefault_model: gone/model\n",
    )
    .unwrap();
    assert_eq!(read(&path).unwrap().default_model, "a/one");

    // And the same on the wire, where a window may hold a default the list has
    // moved on from between two saves.
    let config = AppConfig {
        default_model: "gone/model".into(),
        ..AppConfig::from(&defaults())
    };
    assert_eq!(default_model(&config), defaults().models[0]);
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

/// A model whose id leads with the name of a configured gateway is asked of
/// that gateway, with that gateway's own key: the key is the gateway's, not
/// the app's, which is the whole reason for naming it.
#[test]
fn a_model_is_asked_of_the_gateway_its_id_names() {
    let config = AppConfig {
        gateways: vec![AppGateway {
            id: "anthropic".into(),
            endpoint: "https://api.anthropic.com/v1".into(),
            api_key: "sk-ant-1".into(),
        }],
        ..AppConfig::from(&defaults())
    };
    let spot = destination(&config, "anthropic/claude-sonnet-4.5");
    assert_eq!(spot.gateway, "anthropic");
    assert_eq!(spot.url, "https://api.anthropic.com/v1");
    assert_eq!(spot.key, "sk-ant-1");
    // The app's id for it leads with the gateway's name, which the gateway has
    // never heard of: it is asked for the model's own name.
    assert_eq!(spot.model, "claude-sonnet-4.5");
}

/// A prefix that names no configured gateway is not a gateway: OpenRouter's
/// own vendor-prefixed ids look exactly like one, and they belong to the
/// app's own provider. The name the app knows a URL for makes no difference —
/// routing is by what the file configures, not by what the app could resolve —
/// so `deepseek/…` with no gateway goes to the app's own provider like any
/// other prefix, and so does an id with no prefix at all. The key is the app's
/// own, which is what the fixture holds rather than the empty key the defaults
/// have: a fall-through that quietly kept the default's `""` would pass either
/// way, so the key is made non-empty.
#[test]
fn a_prefix_that_names_no_gateway_goes_to_the_apps_own_provider() {
    let config = AppConfig {
        api_key: "sk-own".into(),
        ..AppConfig::from(&defaults())
    };
    for model in [
        "anthropic/claude-sonnet-4.5",
        "deepseek/deepseek-v4.1-flash",
        "no-prefix-model",
    ] {
        let spot = destination(&config, model);
        assert_eq!(spot.gateway, OPENROUTER);
        assert_eq!(spot.url, OPENROUTER_URL);
        assert_eq!(spot.key, "sk-own");
        // Its id is the model's name there — `deepseek/deepseek-v4.1-flash` is
        // OpenRouter's spelling, vendor prefix and all.
        assert_eq!(spot.model, model);
    }
}

/// A gateway the app has no URL for and that wrote none is not sent to: there
/// is nowhere of its own to send to, so the request falls to the app's own
/// provider — under the app's own key, because the key goes where the request
/// goes. Sending the gateway's key to a provider that never asked for it is the
/// whole of what that rule prevents, and the name comes back as the app's own
/// provider too, so a log line never names a gateway the request did not reach.
#[test]
fn a_gateway_with_no_destination_is_the_apps_own_provider() {
    let config = AppConfig {
        api_key: "sk-own".into(),
        gateways: vec![AppGateway {
            id: "anthropic".into(),
            endpoint: String::new(),
            api_key: "sk-ant-1".into(),
        }],
        ..AppConfig::from(&defaults())
    };
    let spot = destination(&config, "anthropic/claude-sonnet-4.5");
    assert_eq!(spot.gateway, OPENROUTER);
    assert_eq!(spot.url, OPENROUTER_URL);
    assert_eq!(spot.key, "sk-own");
    assert_eq!(spot.model, "anthropic/claude-sonnet-4.5");
}

/// A gateway's name is one segment, since that is all a model's id can lead
/// with: a name written with a slash in it can never be the first segment, and
/// is never matched — the model goes to the app's own provider like any other.
#[test]
fn a_gateway_name_with_a_slash_never_matches() {
    let config = AppConfig {
        api_key: "sk-own".into(),
        gateways: vec![AppGateway {
            id: "acme/anthropic".into(),
            endpoint: "https://api.anthropic.com/v1".into(),
            api_key: "sk-ant-1".into(),
        }],
        ..AppConfig::from(&defaults())
    };
    let spot = destination(&config, "acme/anthropic/claude-sonnet-4.5");
    assert_eq!(spot.gateway, OPENROUTER);
    assert_eq!(spot.url, OPENROUTER_URL);
    assert_eq!(spot.key, "sk-own");
    assert_eq!(spot.model, "acme/anthropic/claude-sonnet-4.5");
}

/// A gateway whose name the app knows needs no endpoint written down: the
/// name is where its requests go.
#[test]
fn a_gateway_the_app_knows_needs_no_endpoint() {
    let config = AppConfig {
        gateways: vec![AppGateway {
            id: "deepseek".into(),
            endpoint: String::new(),
            api_key: "sk-ds-1".into(),
        }],
        ..AppConfig::from(&defaults())
    };
    let spot = destination(&config, "deepseek/deepseek-chat");
    assert_eq!(spot.url, "https://api.deepseek.com/v1");
    assert_eq!(spot.key, "sk-ds-1");
    assert_eq!(spot.model, "deepseek-chat");
}

/// The names that are enough on their own: each service's OpenAI-compatible
/// root, which is the one shape this app speaks. The Add provider screen offers
/// these as pills, and a model's id may lead with one without anything else
/// being written.
#[test]
fn the_names_the_app_knows_are_the_urls_it_holds() {
    assert_eq!(
        known("google"),
        Some("https://generativelanguage.googleapis.com/v1beta/openai")
    );
    assert_eq!(known("mistral"), Some("https://api.mistral.ai/v1"));
    assert_eq!(known("xai"), Some("https://api.x.ai/v1"));
    // Anthropic's own API is not this shape, so its name is not one of them: a
    // gateway called `anthropic` must be told where to send, which is what a
    // proxy or a gateway that speaks this shape is for.
    assert_eq!(known("anthropic"), None);
    assert_eq!(known("meta"), None);
}

/// The gateways are part of the file like anything else: what was written is
/// read back, and a file from before they existed is a file with none.
#[test]
fn gateways_survive_a_round_trip() {
    let path = temp("gateways");
    let settings = Settings {
        gateways: vec![Gateway {
            id: "anthropic".into(),
            endpoint: "https://api.anthropic.com/v1".into(),
            api_key: "sk-ant-1".into(),
        }],
        ..defaults()
    };
    write_to(&path, &settings).unwrap();
    assert_eq!(read(&path).unwrap().gateways, settings.gateways);
    let _ = std::fs::remove_file(&path);

    let old = temp("no-gateways");
    std::fs::write(&old, "provider: openrouter\napi_key: sk-1\nmodels: []\n").unwrap();
    assert!(read(&old).unwrap().gateways.is_empty());
    let _ = std::fs::remove_file(&old);
}

/// A gateway that needs no key — a local Ollama, say — is written with just its
/// name, and the file still parses: every field a gateway can do without is
/// defaulted, since the file is hand-edited and one missing key must not fail
/// the whole file's read and keep the app from starting.
#[test]
fn a_gateway_without_a_key_reads_with_an_empty_one() {
    let path = temp("gateway-no-key");
    std::fs::write(
        &path,
        "provider: openrouter\napi_key: sk-1\nmodels: [x]\ngateways:\n  - id: ollama\n",
    )
    .unwrap();
    let settings = read(&path).unwrap();
    assert_eq!(settings.gateways.len(), 1);
    assert_eq!(settings.gateways[0].id, "ollama");
    assert_eq!(settings.gateways[0].api_key, "");
    assert_eq!(settings.gateways[0].endpoint, "");
    let _ = std::fs::remove_file(&path);
}

/// OpenRouter's URL is OpenRouter however it is spelled, and no other URL is.
#[test]
fn only_openrouters_own_url_is_openrouters() {
    assert!(is_openrouter_url(OPENROUTER_URL));
    assert!(is_openrouter_url("https://openrouter.ai/api/v1/"));
    assert!(!is_openrouter_url("https://api.anthropic.com/v1"));
}

#[test]
fn the_config_crosses_to_the_frontend_in_its_own_spelling() {
    let settings = Settings {
        name: "Valerii".into(),
        provider: OPENROUTER.into(),
        endpoint: String::new(),
        api_key: "sk-1".into(),
        models: vec!["some/model".into()],
        default_model: "some/model".into(),
        system_prompt: "Be brief.".into(),
        gateways: Vec::new(),
    };
    let config = AppConfig::from(&settings);
    assert_eq!(
        serde_json::to_string(&config).unwrap(),
        r#"{"name":"Valerii","provider":"openrouter","endpoint":"","apiKey":"sk-1","models":["some/model"],"defaultModel":"some/model","systemPrompt":"Be brief.","gateways":[]}"#
    );
    assert_eq!(Settings::from(&config), settings);
}
