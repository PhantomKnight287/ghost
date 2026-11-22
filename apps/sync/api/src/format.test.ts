import { expect, test } from "bun:test";
import { mergedText, readMarker, verdictText, withMarker } from "./format.ts";

test("marker and attribution", () => {
  expect(withMarker("hi", "github", "coderabbitai")).toBe("<!-- ghost-sync:from=github author=coderabbitai -->\n**@coderabbitai** on GitHub:\n\nhi");
  expect(withMarker("hi", "ghost", "gurpal")).toBe("<!-- ghost-sync:from=ghost author=gurpal -->\n**@gurpal** on Ghost:\n\nhi");
});

test("round trip", () => {
  expect(readMarker(withMarker("hi", "ghost", "gurpal"))).toEqual({ body: "hi", from: "ghost", author: "gurpal" });
});

test("multi-line bodies survive", () => {
  const body = "line one\n\nline two\n<!-- not ours -->";
  expect(readMarker(withMarker(body, "github", "a")).body).toBe(body);
});

test("no stacking over repeated edits", () => {
  const once = withMarker("hi", "github", "a");
  expect(withMarker(readMarker(once).body, "github", "a")).toBe(once);
  expect(withMarker(readMarker(withMarker(readMarker(once).body, "github", "a")).body, "github", "a")).toBe(once);
});

test("unmarked body", () => {
  expect(readMarker("plain")).toEqual({ body: "plain", from: null, author: null });
});

test("a marker that is not at the start is not ours", () => {
  const body = "quoted:\n<!-- ghost-sync:from=github author=x -->";
  expect(readMarker(body)).toEqual({ body, from: null, author: null });
});

test("empty body", () => {
  expect(readMarker(withMarker("", "ghost", "a"))).toEqual({ body: "", from: "ghost", author: "a" });
});

test("bot logins with brackets", () => {
  expect(readMarker(withMarker("x", "github", "coderabbitai[bot]")).author).toBe("coderabbitai[bot]");
});

test("verdict", () => {
  expect(verdictText("APPROVED", "github", "x")).toBe("Approved on GitHub by @x");
  expect(verdictText("CHANGES_REQUESTED", "ghost", "x")).toBe("Changes requested on Ghost by @x");
  expect(verdictText("COMMENTED", "github", "x")).toBe("Commented on GitHub by @x");
});

test("merged", () => {
  expect(mergedText("ghost")).toBe("Merged on Ghost");
  expect(mergedText("github")).toBe("Merged on GitHub");
});
