import { describe, expect, it } from "bun:test";

import { matchPage } from "./agent-pages";

const match = (path: string) => matchPage(path.split("/").filter(Boolean));

describe("matchPage", () => {
  it("names the public pages", () => {
    expect(match("/")).toEqual({ kind: "home" });
    expect(match("/changelog")).toEqual({ kind: "changelog" });
    expect(match("/ghost")).toEqual({ kind: "profile", username: "ghost" });
    expect(match("/ghost/.ghost")).toEqual({
      kind: "repository",
      username: "ghost",
      repo: ".ghost",
    });
    expect(match("/ghost/ghost/pulls")?.kind).toBe("pulls");
    expect(match("/ghost/ghost/issues/12")).toEqual({
      kind: "issue",
      username: "ghost",
      repo: "ghost",
      number: 12,
    });
    expect(match("/ghost/ghost/pull/3")?.kind).toBe("pull");
  });

  it("leaves app routes, files and deeper pages alone", () => {
    for (const path of [
      "/settings",
      "/dashboard/x",
      "/api/embed/ghost",
      "/robots.txt",
      "/ghost/ghost/tree/main",
      "/ghost/ghost/issues/new",
      "/ghost/ghost/pull/3/files",
      "/ghost/ghost/blob/main/README.md",
    ]) {
      expect(match(path)).toBeNull();
    }
  });
});
