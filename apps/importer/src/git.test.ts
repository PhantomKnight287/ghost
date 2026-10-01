import { afterAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { credentialEnv, listRefs, presentCommits } from "./git.ts";

const never = new AbortController().signal;
const dir = await mkdtemp(path.join(os.tmpdir(), "importer-git-test-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

const env = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};
function git(...args: string[]) {
  const result = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: { ...process.env, ...env },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

git("init", "--quiet", "-b", "main");
git("commit", "--allow-empty", "--quiet", "-m", "first");
git("tag", "v1");
const head = git("rev-parse", "HEAD");

test("credentialEnv scopes a basic header to one origin", () => {
  expect(credentialEnv("https://github.com", "x-access-token", "tok")).toEqual({
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${btoa("x-access-token:tok")}`,
  });
});

test("listRefs lists branches and tags", async () => {
  expect(await listRefs(dir, never)).toEqual(
    new Set(["refs/heads/main", "refs/tags/v1"]),
  );
});

test("presentCommits keeps only commits the history has", async () => {
  expect(await presentCommits(dir, [head, "f".repeat(40)], never)).toEqual(
    new Set([head]),
  );
  expect(await presentCommits(dir, [], never)).toEqual(new Set());
});

test("a failing git command reports its stderr", async () => {
  expect(listRefs(path.join(dir, "missing"), never)).rejects.toThrow(
    /git -C .* for-each-ref .* exited with/,
  );
});
