import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ThemedToken } from "shiki";

import { markMatches } from "./code-search-results";

const token = (content: string, offset: number, color: string) =>
  ({
    content,
    offset,
    htmlStyle: { "--shiki-light": color },
  }) as unknown as ThemedToken;

// const findMe = 1;
const tokens = [
  token("const", 0, "red"),
  token(" ", 5, "grey"),
  token("findMe", 6, "blue"),
  token(" = 1;", 12, "grey"),
];

const render = (ranges: { start: number; end: number }[]) =>
  renderToStaticMarkup(<>{markMatches(tokens, ranges)}</>);

describe("markMatches", () => {
  it("keeps every token as it is when nothing matched", () => {
    expect(render([])).toBe(
      '<span style="--shiki-light:red">const</span><span style="--shiki-light:grey"> </span><span style="--shiki-light:blue">findMe</span><span style="--shiki-light:grey"> = 1;</span>',
    );
  });

  it("cuts a token where a match starts and ends inside it", () => {
    expect(render([{ start: 8, end: 10 }])).toContain(
      '<span style="--shiki-light:blue">fi</span><mark class="rounded-sm bg-primary/25"><span style="--shiki-light:blue">nd</span></mark><span style="--shiki-light:blue">Me</span>',
    );
  });

  it("marks a match spanning several tokens piece by piece, each in its own colour", () => {
    expect(render([{ start: 3, end: 9 }])).toBe(
      '<span style="--shiki-light:red">con</span><mark class="rounded-sm bg-primary/25"><span style="--shiki-light:red">st</span></mark><mark class="rounded-sm bg-primary/25"><span style="--shiki-light:grey"> </span></mark><mark class="rounded-sm bg-primary/25"><span style="--shiki-light:blue">fin</span></mark><span style="--shiki-light:blue">dMe</span><span style="--shiki-light:grey"> = 1;</span>',
    );
  });
});
