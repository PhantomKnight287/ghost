import { existsSync } from "node:fs";
import type { Side } from "./side.ts";

/** `token` is null for `file://` remotes in tests. */
export type Remote = { url: string; token: string | null };
export type PushResult = { ok: true } | { ok: false; reason: "lease" | "rejected"; message: string };
export type GitOps = { fetchBoth: typeof fetchBoth; fetchPullHead: typeof fetchPullHead; isAncestor: typeof isAncestor; pushRef: typeof pushRef };

/** Credentials go in through the environment rather than argv, where any local user could read them from `ps`, and are scoped to one origin so a redirect cannot carry them elsewhere. */
export function credentialEnv(origin: string, username: string, password: string) {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${origin}/.extraHeader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

const envFor = (remote: Remote) => (remote.token ? credentialEnv(new URL(remote.url).origin, "x-access-token", remote.token) : { GIT_TERMINAL_PROMPT: "0" });

async function spawn(args: string[], env: Record<string, string> = {}) {
  const child = Bun.spawn(["git", ...args], { env: { ...process.env, ...env }, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  return { stdout, stderr, code };
}

async function git(args: string[], env?: Record<string, string>) {
  const { stdout, stderr, code } = await spawn(args, env);
  if (code !== 0) throw new Error(`git ${args.join(" ")} exited with ${code}: ${stderr.trim()}`);
  return stdout;
}

async function ensureRepo(dir: string) {
  if (!existsSync(dir)) await git(["init", "--bare", "--quiet", dir]);
}

/** Each side's heads and tags land under `refs/sides/<side>/`, so one side's fetch never overwrites the other's. Returns refname → sha per side. */
export async function fetchBoth(dir: string, remotes: Record<Side, Remote>): Promise<Record<Side, Map<string, string>>> {
  await ensureRepo(dir);
  const refs = async (side: Side) => {
    const namespace = `refs/sides/${side}/`;
    const remote = remotes[side];
    await git(["-C", dir, "fetch", "--quiet", "--prune", "--no-tags", remote.url, `+refs/heads/*:${namespace}heads/*`, `+refs/tags/*:${namespace}tags/*`], envFor(remote));
    const listed = await git(["-C", dir, "for-each-ref", "--format=%(objectname) %(refname)", namespace]);
    return new Map(
      listed
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [sha = "", name = ""] = line.split(" ");
          return [`refs/${name.slice(namespace.length)}`, sha] as const;
        }),
    );
  };
  // Sequential: both fetches write into the same repository.
  const ghost = await refs("ghost");
  return { ghost, github: await refs("github") };
}

export async function fetchPullHead(dir: string, remote: Remote, number: number) {
  const local = `refs/sides/pulls/${number}`;
  await ensureRepo(dir);
  await git(["-C", dir, "fetch", "--quiet", "--no-tags", remote.url, `+refs/pull/${number}/head:${local}`], envFor(remote));
  return (await git(["-C", dir, "rev-parse", local])).trim();
}

export async function isAncestor(dir: string, ancestor: string, descendant: string) {
  const { code, stderr } = await spawn(["-C", dir, "merge-base", "--is-ancestor", ancestor, descendant]);
  if (code > 1) throw new Error(`git merge-base --is-ancestor ${ancestor} ${descendant} exited with ${code}: ${stderr.trim()}`);
  return code === 0;
}

/** `sha` null deletes the ref; `expected` null means the ref must not exist yet. */
export async function pushRef(dir: string, remote: Remote, ref: string, sha: string | null, expected: string | null): Promise<PushResult> {
  const args = ["-C", dir, "push", "--porcelain", `--force-with-lease=${ref}:${expected ?? ""}`, remote.url, `${sha ?? ""}:${ref}`];
  const { stdout, stderr, code } = await spawn(args, envFor(remote));
  if (code === 0) return { ok: true };
  // Porcelain marks a refused ref with "!"; anything else (network, auth) is not an answer about this ref.
  const refused = stdout.split("\n").find((line) => line.startsWith("!"));
  if (!refused) throw new Error(`git push ${remote.url} ${ref} exited with ${code}: ${stderr.trim()}`);
  if (refused.includes("stale info")) return { ok: false, reason: "lease", message: refused.trim() };
  return { ok: false, reason: "rejected", message: `${stderr.trim()}\n${refused.trim()}`.trim() };
}
