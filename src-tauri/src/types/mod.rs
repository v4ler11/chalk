//! OpenAI-compatible Chat Completions API types (`v1/chat/completions`).
//!
//! [`chat`] holds the endpoint envelopes — the request body [`chat::Post`], the
//! non-streamed response [`chat::ChatCompletion`], and the streamed response
//! [`chat::Chunk`] — plus the request-side option types they use (tools,
//! tool choice, response format, stream options, reasoning config).
//!
//! [`chat_message`] holds everything a message can carry: roles, content parts,
//! tool calls, annotations and reasoning/thinking details.

pub mod chat;
pub mod chat_message;
