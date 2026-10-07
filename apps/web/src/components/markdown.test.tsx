import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "./markdown";

/** The rendered markdown, without the wrapper or the image preloads React hoists ahead of it. */
function render(
  markdown: string,
  resolveUrl?: (url: string, key: string) => string,
  repository?: { username: string; repo: string },
) {
  const html = renderToStaticMarkup(
    <Markdown resolveUrl={resolveUrl} repository={repository}>
      {markdown}
    </Markdown>,
  );
  const open = '<div class="markdown">';
  return html.slice(html.indexOf(open) + open.length, -6);
}

const REPOSITORY = { username: "me", repo: "app" };

describe("Markdown", () => {
  it("hands a fenced block with a language to the highlighter, without its trailing newline, and leaves other code as written", () => {
    expect(render("```ts\nconst a = 1;\n```")).toBe(
      "<pre><code>const a = 1;</code></pre>",
    );
    expect(render("```\nplain\n```")).toBe("<pre><code>plain\n</code></pre>");
    expect(render("`inline`")).toBe("<p><code>inline</code></p>");
  });

  it("turns GitHub emoji shortcodes into emoji, outside code", () => {
    expect(render("Ship it :ship: :+1:")).toBe("<p>Ship it 🚢 👍</p>");
    expect(render("`:ship:`")).toBe("<p><code>:ship:</code></p>");
    expect(render(":not-an-emoji:")).toBe("<p>:not-an-emoji:</p>");
  });

  it("keeps the HTML READMEs are actually written with", () => {
    expect(render('<h1 align="center">Ghost</h1>')).toBe(
      '<h1 align="center">Ghost</h1>',
    );
    expect(
      render("<details><summary>s</summary>\n\nbody\n\n</details>"),
    ).toContain("<details><summary>s</summary>");
    expect(
      render('<table><tr><td align="center">x</td></tr></table>'),
    ).toContain('<td style="text-align:center">x</td>');
  });

  it("drops script, event handlers, javascript: and inline style", () => {
    expect(render("<script>alert(1)</script>")).not.toContain("alert");
    expect(render('<img src="x" onerror="alert(1)">')).toBe('<img src="x"/>');
    expect(render('<a href="javascript:alert(1)">x</a>')).not.toContain("href");
    expect(render('<iframe src="https://evil.example.com"></iframe>')).toBe("");
    expect(render('<div style="position:fixed;inset:0">x</div>')).toBe(
      "<div>x</div>",
    );
  });

  /** `align` on a cell becomes `style="text-align:<value>"` downstream of the sanitizer, so anything but the legal values is a CSS injection. */
  it("refuses an align value that would smuggle CSS into style", () => {
    expect(
      render(
        '<table><tr><td align="right;position:fixed;inset:0">x</td></tr></table>',
      ),
    ).not.toContain("position:fixed");
    expect(render("| a |\n|:-:|\n| b |")).toContain(
      'style="text-align:center"',
    );
  });

  it("keeps target and rel, and never opens a tab that keeps the opener", () => {
    expect(
      render('<a href="https://x.example.com" target="_blank">x</a>'),
    ).toContain('rel="noopener noreferrer"');
    expect(
      render(
        '<a href="https://x.example.com" target="_blank" rel="nofollow">x</a>',
      ),
    ).toContain('rel="nofollow noopener noreferrer"');
    expect(
      render('<a href="https://x.example.com" target="_top">x</a>'),
    ).toContain('target="_top"');
    // not a real target: dropped before the component ever sees it
    expect(
      render('<a href="https://x.example.com" target="evilframe">x</a>'),
    ).not.toContain("evilframe");
  });

  it("breaks lines on every newline in comment text, but not in a README", () => {
    expect(render("one\r\ntwo", undefined, REPOSITORY)).toBe(
      "<p>one<br/>\ntwo</p>",
    );
    expect(render("one\ntwo")).toBe("<p>one\ntwo</p>");
    expect(render("`a\nb`", undefined, REPOSITORY)).toBe(
      "<p><code>a b</code></p>",
    );
  });

  it("renders GitHub alerts, and leaves look-alikes as quotes", () => {
    const alert = render(
      "> [!IMPORTANT]\n> ## Revert\n> first",
      undefined,
      REPOSITORY,
    );
    expect(alert).toStartWith(
      '<div class="markdown-alert markdown-alert-important">\n<p class="markdown-alert-title"><svg',
    );
    expect(alert).toContain("Important</p>");
    expect(alert).toContain("<h2>Revert</h2>");
    expect(render("> [!note]\n> body")).toContain("markdown-alert-note");
    expect(render("> [!NOTE]")).toStartWith("<blockquote>");
    expect(render("> [!NOTE] **x**")).toStartWith("<blockquote>");
    expect(render("- > [!NOTE]\n  > body")).not.toContain("markdown-alert");
  });

  it("allows only the alert classes through", () => {
    expect(render('<div class="markdown-alert evil">x</div>')).toBe(
      '<div class="markdown-alert">x</div>',
    );
    expect(render('<p class="evil">x</p>')).toBe("<p>x</p>");
  });

  it("rewrites relative URLs, in markdown and in raw HTML alike", () => {
    const resolveUrl = (url: string, key: string) => `/${key}/${url}`;

    expect(render("![x](shot.png)", resolveUrl)).toContain(
      'src="/src/shot.png"',
    );
    expect(render('<img src="shot.png">', resolveUrl)).toContain(
      'src="/src/shot.png"',
    );
    expect(render("[x](docs/a.md)", resolveUrl)).toContain(
      'href="/href/docs/a.md"',
    );
    expect(render("[x](https://example.com)", resolveUrl)).toContain(
      'href="https://example.com"',
    );
    expect(render("[x](#anchor)", resolveUrl)).toContain('href="#anchor"');
  });

  it("links references in issue text, but not in code, links or files", () => {
    const html = renderToStaticMarkup(
      <Markdown repository={{ username: "me", repo: "app" }}>
        {"Fixes #1 and them/lib#2, cc @bob. `#3` [#4](https://x.io)"}
      </Markdown>,
    );

    expect(html).toContain('href="/me/app/issues/1"');
    expect(html).toContain('href="/them/lib/issues/2"');
    expect(html).toContain('href="/bob"');
    expect(html).toContain("Fixes ");
    expect(html).toContain("<code>#3</code>");
    expect(html).not.toContain("issues/4");
    expect(render("see #1")).not.toContain("href");
  });
});
