import { afterEach, describe, expect, it, mock } from "bun:test";

import { fakeApi } from "./api/fake-api";

mock.module("next/headers", () => ({
  headers: async () => new Headers({ cookie: "session=visitor" }),
}));

const { inlineApiImage, plain } = await import("./og");

describe("plain", () => {
  it("keeps the words of markdown and drops its syntax", () => {
    expect(
      plain(
        "_Opened by [@mariusdill](https://github.com/mariusdill) on GitHub._\n\n## What's Changed\n* fix(web): **bold** `code`",
      ),
    ).toBe(
      "Opened by @mariusdill on GitHub. What's Changed fix(web): bold code",
    );
  });

  it("drops a heading marker", () => {
    expect(plain("# hello 123")).toBe("hello 123");
  });
});

describe("inlineApiImage", () => {
  let restore = () => {};
  afterEach(() => restore());

  it("inlines an image the API serves", async () => {
    restore = fakeApi({
      "/api/users/avatars/a.png": new Response("png", {
        headers: { "content-type": "image/png" },
      }),
    });
    expect(
      await inlineApiImage("http://localhost:3001/api/users/avatars/a.png"),
    ).toBe(`data:image/png;base64,${btoa("png")}`);
  });

  it("asks as the visitor, so the API counts it against the web app's budget", async () => {
    const original = globalThis.fetch;
    let sent: HeadersInit | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      sent = init?.headers;
      return new Response("png", { headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch;
    restore = () => {
      globalThis.fetch = original;
    };
    await inlineApiImage("http://localhost:3001/api/users/avatars/a.png");
    expect(sent).toMatchObject({ cookie: "session=visitor" });
  });

  it("leaves an image on another host, or none, as it is", async () => {
    expect(
      await inlineApiImage("https://avatars.githubusercontent.com/u/1"),
    ).toBe("https://avatars.githubusercontent.com/u/1");
    expect(await inlineApiImage(null)).toBeNull();
  });

  it("gives up on an image the API cannot serve", async () => {
    restore = fakeApi({});
    expect(
      await inlineApiImage("http://localhost:3001/api/users/avatars/gone.png"),
    ).toBeNull();
    globalThis.fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    expect(
      await inlineApiImage("http://localhost:3001/api/users/avatars/a.png"),
    ).toBeNull();
  });
});
