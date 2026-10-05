import { memo, useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import { Check, Copy } from "lucide-react";
import type { Element, ElementContent } from "hast";
import type { ExtraProps } from "react-markdown";
import { copyText } from "../clipboard";

/** What the fence said the block was written in, if it said anything. */
function languageOf(node: Element | undefined): string | null {
  const code = node?.children.find(
    (child): child is Element => child.type === "element" && child.tagName === "code",
  );
  const names = code?.properties.className;
  const found = names?.find(
    (name) => typeof name === "string" && name.startsWith("language-"),
  );
  return typeof found === "string" ? found.slice("language-".length) : null;
}

/**
 * The code as it was written, read from the tree rather than from the spans the
 * highlighter made of it: what is copied is the code, down to its whitespace,
 * and not the colours.
 */
function textOf(node: Element | undefined): string {
  const parts: string[] = [];
  function collect(child: ElementContent) {
    if (child.type === "text") parts.push(child.value);
    else if (child.type === "element") child.children.forEach(collect);
  }
  node?.children.forEach(collect);
  return parts.join("");
}

/**
 * A block of code, with what it was written in and a button that copies it.
 *
 * This is the `pre` override, and a block is the only thing that is a `pre`: the
 * head therefore lands under every block of code and under nothing else, the
 * inline kind being left exactly as it was. What the button copies is read from
 * the tree the parser built, so it is the code itself; the one newline the fence
 * contributes at the end is dropped, that newline being the fence's and not the
 * code's.
 *
 * The code is highlighted in place by the language, so what is under this is the
 * parser's own children — spans for a language that was recognised, one text
 * node for one that was not.
 */
export const CodeBlock = memo(function CodeBlock({
  node,
  children,
  ...rest
}: ComponentPropsWithoutRef<"pre"> & ExtraProps) {
  const [copied, setCopied] = useState(false);
  const language = languageOf(node);
  const text = textOf(node);

  async function copy() {
    if (!(await copyText(text.replace(/\n$/, "")))) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }

  return (
    <div className="code-block">
      <div className="code-head">
        {/* A fence with nothing on it is plain text, and says so. */}
        <span className="code-language">{language ?? "text"}</span>
        <button
          type="button"
          className="code-copy"
          title="Copy code"
          aria-label="Copy code"
          onClick={copy}
        >
          {copied ? <Check className="icon" /> : <Copy className="icon" />}
        </button>
      </div>
      <pre {...rest}>{children}</pre>
    </div>
  );
});
