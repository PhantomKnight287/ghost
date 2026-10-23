import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { CursorPaginationLinks as CursorPagination } from "./cursor-pagination";

const hrefs = (html: string) =>
  [...html.matchAll(/href="([^"]*)"/g)].map((match) =>
    match[1].replaceAll("&amp;", "&"),
  );

describe("CursorPagination", () => {
  test("renders nothing when everything fits on one page", () => {
    expect(
      renderToStaticMarkup(
        <CursorPagination
          pathname="/x"
          cursor={undefined}
          nextCursor={null}
          trail={[]}
        />,
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
        trail={[]}
      />,
    );
    expect(hrefs(html)).toEqual([
      "/ghost?tab=repositories",
      "/ghost?tab=repositories&cursor=abc",
    ]);
  });

  test("goes back to the bare path when there are no parameters", () => {
    const html = renderToStaticMarkup(
      <CursorPagination
        pathname="/c"
        cursor="abc"
        nextCursor={null}
        trail={[]}
      />,
    );
    expect(hrefs(html)).toEqual(["/c", "/c"]);
  });

  test("steps back one page, not to the first, from deep in the list", () => {
    const html = renderToStaticMarkup(
      <CursorPagination
        pathname="/i"
        params={{ state: "open" }}
        cursor="c3"
        nextCursor="c4"
        trail={["c2"]}
      />,
    );
    expect(hrefs(html)).toEqual([
      "/i?state=open&cursor=c2",
      "/i?state=open&prev=c2&prev=c3&cursor=c4",
    ]);
  });

  test("records the page left behind when going older", () => {
    const html = renderToStaticMarkup(
      <CursorPagination pathname="/i" cursor="c2" nextCursor="c3" trail={[]} />,
    );
    expect(hrefs(html)).toEqual(["/i", "/i?prev=c2&cursor=c3"]);
  });

  test("keeps cursors with commas intact", () => {
    const html = renderToStaticMarkup(
      <CursorPagination
        pathname="/t"
        cursor="v1,2"
        nextCursor="v0,9"
        trail={["v2,0"]}
      />,
    );
    expect(hrefs(html)).toEqual([
      "/t?cursor=v2%2C0",
      "/t?prev=v2%2C0&prev=v1%2C2&cursor=v0%2C9",
    ]);
  });

  test("labels the buttons Newer and Older", () => {
    const html = renderToStaticMarkup(
      <CursorPagination pathname="/i" cursor="c2" nextCursor="c3" trail={[]} />,
    );
    expect(html).toContain(">Newer<");
    expect(html).toContain(">Older<");
  });
});
