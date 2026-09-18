import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "./markdown";

/** The rendered markdown, without the wrapper's class soup. */
function render(
  markdown: string,
  resolveUrl?: (url: string, key: string) => string,
) {
  const html = renderToStaticMarkup(
    <Markdown resolveUrl={resolveUrl}>{markdown}</Markdown>,
  );
  return html.slice(html.indexOf('pl-1">') + 6, -6);
}

describe("Markdown", () => {
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

  /**
   * `align` on a cell becomes `style="text-align:<value>"` downstream of the
   * sanitizer, so anything but the legal values is a CSS injection.
   */
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

  it("gives every link the w-fit class", () => {
    expect(render("[x](https://example.com)")).toContain("w-fit");
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
});
