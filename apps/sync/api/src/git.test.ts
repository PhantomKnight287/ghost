import { describe, expect, test } from "bun:test";
import { credentialEnv, fetchBoth, fetchPullHead, isAncestor, pushRef } from "./git.ts";
import { hostRepo, run, scratchDir } from "./lib/git-fixture.ts";

const remote = (host: { url: string }) => ({ url: host.url, token: null });

function pair() {
  const ghost = hostRepo("ghost");
  const github = hostRepo("github");
  return { ghost, github, dir: scratchDir(), remotes: { ghost: remote(ghost), github: remote(github) } };
}

describe("fetchBoth", () => {
  test("maps each side's heads and tags, kept apart", async () => {
    const { ghost, github, dir, remotes } = pair();
    const a = ghost.commit("main", "a");
    ghost.tag("v1", a);
    const b = github.commit("main", "b");
    const refs = await fetchBoth(dir, remotes);
    expect(refs.ghost).toEqual(new Map([["refs/heads/main", a], ["refs/tags/v1", a]]));
    expect(refs.github).toEqual(new Map([["refs/heads/main", b]]));
  });

  test("a ref deleted on a side disappears on the next fetch", async () => {
    const { ghost, dir, remotes } = pair();
    ghost.commit("main", "a");
    ghost.commit("feat", "b");
    await fetchBoth(dir, remotes);
    run(ghost.bare, "update-ref", "-d", "refs/heads/feat");
    expect((await fetchBoth(dir, remotes)).ghost.has("refs/heads/feat")).toBe(false);
  });

  test("an empty repository maps to nothing", async () => {
    const { ghost, dir, remotes } = pair();
    ghost.commit("main", "a");
    expect((await fetchBoth(dir, remotes)).github.size).toBe(0);
  });
});

describe("isAncestor", () => {
  test("parent to child, not siblings", async () => {
    const { ghost, dir, remotes } = pair();
    const a = ghost.commit("main", "a");
    const b = ghost.commit("main", "b");
    ghost.checkout(a);
    const c = ghost.commit("side", "c");
    await fetchBoth(dir, remotes);
    expect(await isAncestor(dir, a, b)).toBe(true);
    expect(await isAncestor(dir, b, a)).toBe(false);
    expect(await isAncestor(dir, b, c)).toBe(false);
  });
});

describe("pushRef", () => {
  async function seeded() {
    const p = pair();
    const a = p.ghost.commit("main", "a");
    const b = p.ghost.commit("main", "b");
    await fetchBoth(p.dir, p.remotes);
    return { ...p, a, b };
  }

  test("creates when expected is null", async () => {
    const { github, dir, remotes, b } = await seeded();
    expect(await pushRef(dir, remotes.github, "refs/heads/main", b, null)).toEqual({ ok: true });
    expect(github.ref("refs/heads/main")).toBe(b);
  });

  test("fast-forwards, force-moves and deletes when expected matches", async () => {
    const { github, dir, remotes, a, b } = await seeded();
    await pushRef(dir, remotes.github, "refs/heads/main", a, null);
    expect(await pushRef(dir, remotes.github, "refs/heads/main", b, a)).toEqual({ ok: true });
    expect(await pushRef(dir, remotes.github, "refs/heads/main", a, b)).toEqual({ ok: true });
    expect(github.ref("refs/heads/main")).toBe(a);
    expect(await pushRef(dir, remotes.github, "refs/heads/main", null, a)).toEqual({ ok: true });
    expect(github.ref("refs/heads/main")).toBeNull();
  });

  test("a ref that moved away from expected is a lease failure and keeps the person's commit", async () => {
    const { github, dir, remotes, a, b } = await seeded();
    await pushRef(dir, remotes.github, "refs/heads/main", a, null);
    github.pull("main");
    const theirs = github.commit("main", "pushed by a person meanwhile");
    const result = await pushRef(dir, remotes.github, "refs/heads/main", b, a);
    expect(result).toMatchObject({ ok: false, reason: "lease" });
    expect(github.ref("refs/heads/main")).toBe(theirs);
  });

  test("creating over an existing ref is a lease failure", async () => {
    const { github, dir, remotes, a, b } = await seeded();
    await pushRef(dir, remotes.github, "refs/heads/main", a, null);
    expect(await pushRef(dir, remotes.github, "refs/heads/main", b, null)).toMatchObject({ ok: false, reason: "lease" });
    expect(github.ref("refs/heads/main")).toBe(a);
  });

  test("deleting a ref that moved is a lease failure", async () => {
    const { github, dir, remotes, a, b } = await seeded();
    await pushRef(dir, remotes.github, "refs/heads/main", b, null);
    expect(await pushRef(dir, remotes.github, "refs/heads/main", null, a)).toMatchObject({ ok: false, reason: "lease" });
    expect(github.ref("refs/heads/main")).toBe(b);
  });

  test("a hook's refusal is a rejection carrying its message", async () => {
    const { github, dir, remotes, b } = await seeded();
    github.rejectPushes("protected branch");
    const result = await pushRef(dir, remotes.github, "refs/heads/main", b, null);
    expect(result).toMatchObject({ ok: false, reason: "rejected" });
    expect(result.ok === false && result.message).toContain("protected branch");
  });

  test("tags push too", async () => {
    const { github, dir, remotes, a } = await seeded();
    expect(await pushRef(dir, remotes.github, "refs/tags/v1", a, null)).toEqual({ ok: true });
    expect(github.ref("refs/tags/v1")).toBe(a);
  });
});

describe("fetchPullHead", () => {
  test("reads refs/pull/<n>/head", async () => {
    const { ghost, dir, remotes } = pair();
    const a = ghost.commit("main", "a");
    run(ghost.bare, "update-ref", "refs/pull/3/head", a);
    expect(await fetchPullHead(dir, remotes.ghost, 3)).toBe(a);
  });
});

describe("credentials", () => {
  test("credentialEnv sets one scoped extra header and no prompt", () => {
    expect(credentialEnv("https://github.com", "x-access-token", "ghs_secret")).toEqual({
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from("x-access-token:ghs_secret").toString("base64")}`,
    });
  });

  test("a failing fetch never puts the token in its error", async () => {
    const error = await fetchBoth(scratchDir(), {
      ghost: { url: "http://127.0.0.1:9/acme/app.git", token: "ghs_secret" },
      github: { url: "http://127.0.0.1:9/acme-gh/app.git", token: "ghs_secret" },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).not.toContain("ghs_secret");
    expect(String((error as Error).message)).not.toContain(Buffer.from("x-access-token:ghs_secret").toString("base64"));
  });
});
