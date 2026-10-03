import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

/**
 * Markdown rendering, memoized on the text.
 *
 * A settled block of a streaming answer keeps its exact text for the rest of the
 * response, so it parses once and is then skipped on every later token — only
 * the block still growing costs anything per token. The committed assistant
 * message gets the same component, so what arrives streaming is what stays once
 * it is done. Prompts are plain text and never reach here.
 *
 * Math is rendered by KaTeX. Half-arrived math is not a crash: an unclosed `$`
 * is not math at all and stays literal, and a formula that closes but does not
 * parse falls back to its own TeX text; either way the next token replaces it.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm, remarkMath]} rehypePlugins={[rehypeKatex]}>
      {text}
    </ReactMarkdown>
  );
});
