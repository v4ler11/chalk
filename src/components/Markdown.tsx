import { memo } from "react";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import type { Element } from "hast";
import type { ExtraProps } from "react-markdown";
import { CodeBlock } from "./CodeBlock";

/** Where an ordered list begins, as the parser's tree carries it: a list written
 *  from `1.` begins at one, and one that starts further down says so. */
function startOf(node: Element | undefined): number {
  const start = node?.properties.start;
  if (typeof start === "number") return start;
  return typeof start === "string" ? Number(start) || 1 : 1;
}

/**
 * The lists the markdown itself makes, marked as they are drawn.
 *
 * A message holds two kinds of list: the ones the answer was written with, and
 * the app's own — the calls a turn made, the servers, the models. They are drawn
 * differently: a list of prose carries a mark, and the app's carry none, since a
 * row already says what it is. The sheet cannot tell them apart from the markup
 * alone, so the renderer says which is which: everything it renders is `prose`,
 * and `main.css` draws the marks for those lists and no others.
 */
function ProseList({
  node: _node,
  children,
  ...rest
}: ComponentPropsWithoutRef<"ul"> & ExtraProps) {
  return (
    <ul {...rest} className="prose">
      {children}
    </ul>
  );
}

/**
 * An ordered list, with where its numbering begins written onto it.
 *
 * The numbers are drawn by the sheet rather than by the platform's markers — see
 * the prose lists in `main.css`, where a marker's own paint outlives the
 * selection — and a counter begins nowhere until something resets it. `start` is
 * an attribute CSS cannot read, so the reset is written out here, from the tree
 * the markdown was parsed into: the first item of the list is the number the
 * source gave it, and every list is counted on its own.
 */
function OrderedList({
  node,
  children,
  style,
  ...rest
}: ComponentPropsWithoutRef<"ol"> & ExtraProps) {
  return (
    <ol
      {...rest}
      className="prose"
      style={{ ...style, counterReset: `item ${startOf(node) - 1}` }}
    >
      {children}
    </ol>
  );
}

/** One object for the whole app: React re-renders the tree either way, but a
 *  fresh one per render would be a new component type to no purpose. */
const components = { pre: CodeBlock, ul: ProseList, ol: OrderedList };

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
 *
 * Code is coloured by the language its fence names, and only by that: a fence
 * with no language is left plain rather than guessed at, since a wrong guess is
 * worse than no colour at all, and a language the highlighter does not know is
 * left plain by it and reported nowhere. `CodeBlock` is what a block is drawn
 * as, which is where its copy button lives.
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex, rehypeHighlight]}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});
