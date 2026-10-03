//! `v1/chat/completions` endpoint envelopes: request [`Post`], non-streamed
//! response [`ChatCompletion`], streamed response [`Chunk`], and the request-side
//! option types they reference.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::chat_message::{FunctionCall, Message, ReasoningDetail, Role, ToolCallChunk};

/// Request body for `POST /v1/chat/completions`.
///
/// Only `model` and `messages` are required; every other field is omitted when
/// `None`, so the serialized body stays minimal.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Post {
    pub model: String,
    pub messages: Vec<Message>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream: Option<bool>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stream_options: Option<StreamOptions>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub temperature: Option<f32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_p: Option<f32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub n: Option<u32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stop: Option<Stop>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_completion_tokens: Option<u32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub presence_penalty: Option<f32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frequency_penalty: Option<f32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logit_bias: Option<HashMap<String, i32>>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logprobs: Option<bool>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_logprobs: Option<u32>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seed: Option<i64>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub response_format: Option<ResponseFormat>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tools: Option<Vec<Tool>>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_choice: Option<ToolChoice>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parallel_tool_calls: Option<bool>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modalities: Option<Vec<String>>,

    /// Unified reasoning/thinking control (OpenRouter-style; also honoured by
    /// gateways that translate it to provider-native fields).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<ReasoningConfig>,

    /// OpenAI-native reasoning effort (`low`/`medium`/`high`/…).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_effort: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub store: Option<bool>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<Value>,
}

/// `stop`: a single sequence or a list of them.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum Stop {
    One(String),
    Many(Vec<String>),
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct StreamOptions {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_usage: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub include_obfuscation: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ReasoningConfig {
    /// `max` | `xhigh` | `high` | `medium` | `low` | `minimal` | `none`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub effort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exclude: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
    /// OpenRouter `context` mode: `auto` | `all_turns` | `current_turn`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub context: Option<String>,
}

/// A tool the model may call (`ChatCompletionTool` / `CustomToolChatCompletions`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Tool {
    Function { function: FunctionDef },
    Custom { custom: CustomToolDef },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct FunctionDef {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// JSON Schema for the arguments.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parameters: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict: Option<bool>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CustomToolDef {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub format: Option<ToolFormat>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ToolFormat {
    Text,
    Grammar { grammar: GrammarDef },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct GrammarDef {
    pub definition: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub syntax: Option<String>,
}

/// `tool_choice`: a mode string, a named tool, or an allowed-tools constraint.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(untagged)]
pub enum ToolChoice {
    Mode(ToolChoiceMode),
    Named(NamedToolChoice),
    Allowed(AllowedToolsChoice),
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolChoiceMode {
    None,
    Auto,
    Required,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NamedToolChoice {
    Function { function: NamedTool },
    Custom { custom: NamedTool },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct NamedTool {
    pub name: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AllowedToolsChoice {
    AllowedTools { allowed_tools: AllowedTools },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct AllowedTools {
    pub mode: AllowedToolsMode,
    /// Tool definitions (only their names are consulted by the API).
    pub tools: Vec<Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AllowedToolsMode {
    Auto,
    Required,
}

/// `response_format`: text, JSON object, or a JSON Schema.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ResponseFormat {
    Text,
    JsonObject,
    JsonSchema { json_schema: JsonSchema },
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct JsonSchema {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// A JSON Schema object.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub schema: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub strict: Option<bool>,
}

/// Why the model stopped generating tokens.
///
/// Unknown values are preserved in [`FinishReason::Other`].
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(from = "String", into = "String")]
pub enum FinishReason {
    Stop,
    Length,
    ToolCalls,
    ContentFilter,
    FunctionCall,
    Other(String),
}

impl From<String> for FinishReason {
    fn from(reason: String) -> Self {
        match reason.as_str() {
            "stop" => FinishReason::Stop,
            "length" => FinishReason::Length,
            "tool_calls" => FinishReason::ToolCalls,
            "content_filter" => FinishReason::ContentFilter,
            "function_call" => FinishReason::FunctionCall,
            _ => FinishReason::Other(reason),
        }
    }
}

impl From<FinishReason> for String {
    fn from(reason: FinishReason) -> Self {
        match reason {
            FinishReason::Stop => "stop".to_owned(),
            FinishReason::Length => "length".to_owned(),
            FinishReason::ToolCalls => "tool_calls".to_owned(),
            FinishReason::ContentFilter => "content_filter".to_owned(),
            FinishReason::FunctionCall => "function_call".to_owned(),
            FinishReason::Other(other) => other,
        }
    }
}

/// A non-streamed completion (`CreateChatCompletionResponse`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ChatCompletion {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub object: String,
    #[serde(default)]
    pub created: i64,
    #[serde(default)]
    pub model: String,
    pub choices: Vec<Choice>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Choice {
    #[serde(default)]
    pub index: u32,
    pub message: Message,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<FinishReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logprobs: Option<Logprobs>,
}

/// One streamed chunk (`CreateChatCompletionStreamResponse`).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Chunk {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub object: String,
    #[serde(default)]
    pub created: i64,
    #[serde(default)]
    pub model: String,
    pub choices: Vec<ChunkChoice>,
    /// Present only when `stream_options.include_usage` is set.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub usage: Option<Usage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub system_fingerprint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_tier: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub obfuscation: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ChunkChoice {
    #[serde(default)]
    pub index: u32,
    pub delta: Delta,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub finish_reason: Option<FinishReason>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logprobs: Option<Logprobs>,
}

/// A streamed delta (`ChatCompletionStreamResponseDelta`), including the
/// `reasoning`/`reasoning_content`/`reasoning_details` thinking extensions.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Delta {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub role: Option<Role>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refusal: Option<String>,
    /// Deprecated; superseded by [`Delta::tool_calls`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub function_call: Option<FunctionCall>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_calls: Option<Vec<ToolCallChunk>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_details: Option<Vec<ReasoningDetail>>,
}

impl Delta {
    /// The reasoning text carried by this delta, empty when it carries none.
    ///
    /// OpenRouter sends the same text in `reasoning` *and* `reasoning_details`,
    /// so the plain fields win and the structured blocks are only summed when
    /// neither is present — otherwise the thinking would be doubled.
    pub fn reasoning_text(&self) -> String {
        if let Some(text) = self.reasoning.as_deref().filter(|t| !t.is_empty()) {
            return text.to_owned();
        }
        if let Some(text) = self.reasoning_content.as_deref().filter(|t| !t.is_empty()) {
            return text.to_owned();
        }
        self.reasoning_details
            .iter()
            .flatten()
            .map(|detail| match detail {
                ReasoningDetail::Text { text, .. } => text.as_str(),
                ReasoningDetail::Summary { summary, .. } => summary.as_str(),
                ReasoningDetail::Encrypted { .. } => "",
            })
            .collect()
    }
}

/// Token usage (`CompletionUsage`), plus the billing fields OpenRouter adds.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct Usage {
    #[serde(default)]
    pub prompt_tokens: u32,
    #[serde(default)]
    pub completion_tokens: u32,
    #[serde(default)]
    pub total_tokens: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub completion_tokens_details: Option<CompletionTokensDetails>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prompt_tokens_details: Option<PromptTokensDetails>,
    /// What the request cost, in USD.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost: Option<f64>,
    /// True when the caller's own provider credentials were used.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub is_byok: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cost_details: Option<CostDetails>,
}

/// Per-upstream cost breakdown reported alongside [`Usage`].
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct CostDetails {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream_inference_cost: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream_inference_prompt_cost: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub upstream_inference_completions_cost: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct CompletionTokensDetails {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted_prediction_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reasoning_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rejected_prediction_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_tokens: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct PromptTokensDetails {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub audio_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cached_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub video_tokens: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cache_write_tokens: Option<u32>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Logprobs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<Vec<TokenLogprob>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refusal: Option<Vec<TokenLogprob>>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TokenLogprob {
    pub token: String,
    pub logprob: f64,
    /// UTF-8 byte representation of the token, when available.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<Vec<u8>>,
    #[serde(default)]
    pub top_logprobs: Vec<TopLogprob>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct TopLogprob {
    pub token: String,
    pub logprob: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bytes: Option<Vec<u8>>,
}

#[cfg(test)]
mod tests {
    use super::Chunk;

    /// Verbatim OpenRouter frames (`deepseek/deepseek-v4.1-flash`), which carry
    /// thinking and answer in separate frames and repeat the thinking text in
    /// both `reasoning` and `reasoning_details`.
    const FRAMES: &[&str] = &[
        r#"{"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"m","provider":"Together","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":"We","reasoning_details":[{"type":"reasoning.text","text":"We","format":"unknown","index":0}]},"finish_reason":null}]}"#,
        r#"{"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"m","provider":"Together","choices":[{"index":0,"delta":{"content":"","role":"assistant","reasoning":" need answer.","reasoning_details":[{"type":"reasoning.text","text":" need answer.","format":"unknown","index":0}]},"finish_reason":null}]}"#,
        r#"{"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":"Hi","role":"assistant"},"finish_reason":null}]}"#,
        r#"{"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"m","choices":[{"index":0,"delta":{"content":" there","role":"assistant"},"finish_reason":"stop"}]}"#,
    ];

    #[test]
    fn frames_yield_thinking_once_and_the_answer() {
        let chunks: Vec<Chunk> = FRAMES.iter().map(|f| serde_json::from_str(f).expect("valid frame")).collect();

        let mut thinking = String::new();
        let mut answer = String::new();
        for choice in chunks.iter().flat_map(|chunk| chunk.choices.iter()) {
            thinking.push_str(&choice.delta.reasoning_text());
            answer.push_str(choice.delta.content.as_deref().unwrap_or(""));
        }

        assert_eq!(thinking, "We need answer.");
        assert_eq!(answer, "Hi there");
    }

    /// The closing frame OpenRouter sends when `stream_options.include_usage` is
    /// set: the last choice plus the token counts and the price.
    const USAGE_FRAME: &str = r#"{"id":"gen-1","object":"chat.completion.chunk","created":1,"model":"m","provider":"DeepInfra","choices":[{"index":0,"delta":{"content":"","role":"assistant"},"finish_reason":"stop"}],"usage":{"prompt_tokens":36,"completion_tokens":72,"total_tokens":108,"cost":0.00003528,"is_byok":false,"prompt_tokens_details":{"cached_tokens":0,"cache_write_tokens":0,"audio_tokens":0,"video_tokens":0},"cost_details":{"upstream_inference_cost":0.00003528,"upstream_inference_prompt_cost":0.00000504,"upstream_inference_completions_cost":0.00003024},"completion_tokens_details":{"reasoning_tokens":69,"image_tokens":0,"audio_tokens":0}}}"#;

    #[test]
    fn usage_frame_carries_tokens_and_price() {
        let chunk: Chunk = serde_json::from_str(USAGE_FRAME).expect("valid frame");
        let usage = chunk.usage.expect("usage present");
        let prompt = usage.prompt_tokens_details.expect("prompt details");
        let completion = usage.completion_tokens_details.expect("completion details");
        let costs = usage.cost_details.expect("cost breakdown");

        assert_eq!(usage.prompt_tokens, 36);
        assert_eq!(usage.completion_tokens, 72);
        assert_eq!(usage.total_tokens, 108);
        assert_eq!(prompt.cached_tokens, Some(0));
        assert_eq!(prompt.video_tokens, Some(0));
        assert_eq!(completion.reasoning_tokens, Some(69));
        assert_eq!(completion.image_tokens, Some(0));
        assert_eq!(usage.cost, Some(0.00003528));
        assert_eq!(costs.upstream_inference_prompt_cost, Some(0.00000504));
        assert_eq!(costs.upstream_inference_completions_cost, Some(0.00003024));
    }
}
