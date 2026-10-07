"use client";

import { Fragment, useEffect, useState } from "react";
import type { ThemedToken } from "shiki";

import { highlightLines } from "@/lib/highlight";

/** A fenced block's code, plain until its tokens arrive. Coloured for every theme at once, so a theme switch needs no second pass. */
export function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language: string;
}) {
  const [highlighted, setHighlighted] = useState<{
    code: string;
    tokens: ThemedToken[][];
  }>();

  useEffect(() => {
    let cancelled = false;
    // a bare language name resolves like a file extension: `ts`, `py`, `dockerfile`
    highlightLines(code, language)
      .then((tokens) => {
        if (!cancelled) setHighlighted({ code, tokens });
      })
      // a grammar the engine cannot run leaves the block plain
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, language]);

  // tokens for text that has since been edited would show the old text
  if (highlighted?.code !== code) return <code>{code}</code>;

  return (
    <code data-shiki>
      {highlighted.tokens.map((line, index) => (
        <Fragment key={index}>
          {index > 0 && "\n"}
          {line.map((token) => (
            <span key={token.offset} style={token.htmlStyle}>
              {token.content}
            </span>
          ))}
        </Fragment>
      ))}
    </code>
  );
}
