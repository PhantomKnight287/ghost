import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CursorPagination } from "./cursor-pagination";

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]*)"/g)].map((match) =>
    match[1].replaceAll("&amp;", "&"),
  );

describe("CursorPagination", () => {
  test("renders nothing when everything fits on one page", () => {
    expect(
      renderToStaticMarkup(
        <CursorPagination pathname="/x" cursor={undefined} nextCursor={null} />,
      ),
    ).toBe("");
  });

  test("keeps set parameters, drops unset ones, and adds the next cursor", () => {
    const html = renderToStaticMarkup(
      <CursorPagination
        pathname="/ghost"
        params={{ tab: "repositories", q: "" }}
        cursor={undefined}
        nextCursor="abc"
      />,
    );
    expect(hrefs(html)).toEqual([
      "/ghost?tab=repositories",
      "/ghost?tab=repositories&cursor=abc",
    ]);
  });

  test("goes back to the bare path when there are no parameters", () => {
    const html = renderToStaticMarkup(
      <CursorPagination pathname="/c" cursor="abc" nextCursor={null} />,
    );
    expect(hrefs(html)).toEqual(["/c", "/c"]);
  });
});
