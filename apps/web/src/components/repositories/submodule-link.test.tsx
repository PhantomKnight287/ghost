import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SITE_URL } from "@/lib/env";

import { SubmoduleLink } from "./submodule-link";

const oid = "3f786850e387550fdab836ed7e6dc881de23001b";

describe("SubmoduleLink", () => {
  test("links the name and short commit to a page on this instance in the same tab", () => {
    const html = renderToStaticMarkup(
      <SubmoduleLink
        entry={{
          name: "lib",
          oid,
          submodule: {
            url: "../lib.git",
            href: `${SITE_URL}/octo/lib/tree/${oid}`,
          },
        }}
      />,
    );

    expect(html).toContain(`href="${SITE_URL}/octo/lib/tree/${oid}"`);
    expect(html).not.toContain("target=");
    expect(html).toContain('title="../lib.git"');
    expect(html).toContain("@ 3f78685");
  });

  test("opens a page on another site in a new tab", () => {
    const html = renderToStaticMarkup(
      <SubmoduleLink
        entry={{
          name: "lib",
          oid,
          submodule: {
            url: "git@github.com:octo/lib.git",
            href: `https://github.com/octo/lib/tree/${oid}`,
          },
        }}
      />,
    );

    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  test("shows the URL without a link when it names no repository page", () => {
    const html = renderToStaticMarkup(
      <SubmoduleLink
        entry={{
          name: "lib",
          oid,
          submodule: { url: "/srv/git/lib.git", href: null },
        }}
      />,
    );

    expect(html).not.toContain("href=");
    expect(html).toContain('title="/srv/git/lib.git"');
  });

  test("names it a submodule when .gitmodules gives no URL", () => {
    const html = renderToStaticMarkup(
      <SubmoduleLink entry={{ name: "lib", oid, submodule: null }} />,
    );

    expect(html).not.toContain("href=");
    expect(html).toContain('title="Submodule"');
  });
});
