import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SubmoduleLink } from "./submodule-link";

const oid = "3f786850e387550fdab836ed7e6dc881de23001b";

describe("SubmoduleLink", () => {
  test("links the name and short commit to the page the API gives", () => {
    const html = renderToStaticMarkup(
      <SubmoduleLink
        entry={{
          name: "lib",
          oid,
          submodule: {
            url: "../lib.git",
            href: `https://ghost.test/octo/lib/tree/${oid}`,
          },
        }}
      />,
    );

    expect(html).toContain(`href="https://ghost.test/octo/lib/tree/${oid}"`);
    expect(html).toContain('title="../lib.git"');
    expect(html).toContain("@ 3f78685");
  });

  test("shows the URL without a link when the host has no known page", () => {
    const html = renderToStaticMarkup(
      <SubmoduleLink
        entry={{
          name: "lib",
          oid,
          submodule: { url: "https://git.example.com/lib.git", href: null },
        }}
      />,
    );

    expect(html).not.toContain("href=");
    expect(html).toContain('title="https://git.example.com/lib.git"');
  });

  test("names it a submodule when .gitmodules gives no URL", () => {
    const html = renderToStaticMarkup(
      <SubmoduleLink entry={{ name: "lib", oid, submodule: null }} />,
    );

    expect(html).not.toContain("href=");
    expect(html).toContain('title="Submodule"');
  });
});
