import { describe, expect, it } from "bun:test";

import { plain } from "./og";

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
