import type { GitOps, Remote } from "../git.ts";
import type { Side } from "../side.ts";

export type FakeGit = GitOps & {
  repos: Record<Side, Map<string, string>>;
  pushes: { side: Side; ref: string; sha: string | null; expected: string | null }[];
  /** `"a>b"`: a is an ancestor of b. */
  ancestors: Set<string>;
  pullHeads: Map<number, string>;
  /** Refs a side's protection refuses, with git's message. */
  rejects: Map<string, string>;
};

export const fakeRemotes: Record<Side, Remote> = { ghost: { url: "ghost", token: null }, github: { url: "github", token: null } };

/** Two repositories as ref maps, for tests that are about decisions rather than git. `remote.url` names the side. */
export function fakeGit(refs: Partial<Record<Side, Record<string, string>>> = {}): FakeGit {
  const git: FakeGit = {
    repos: { ghost: new Map(Object.entries(refs.ghost ?? {})), github: new Map(Object.entries(refs.github ?? {})) },
    pushes: [],
    ancestors: new Set(),
    pullHeads: new Map(),
    rejects: new Map(),
    async fetchBoth() {
      return { ghost: new Map(git.repos.ghost), github: new Map(git.repos.github) };
    },
    async fetchPullHead(_dir, _remote, number) {
      const sha = git.pullHeads.get(number);
      if (!sha) throw new Error(`no refs/pull/${number}/head`);
      return sha;
    },
    async isAncestor(_dir, ancestor, descendant) {
      return ancestor === descendant || git.ancestors.has(`${ancestor}>${descendant}`);
    },
    async pushRef(_dir, remote, ref, sha, expected) {
      const side = remote.url as Side;
      git.pushes.push({ side, ref, sha, expected });
      const rejected = git.rejects.get(`${side} ${ref}`);
      if (rejected) return { ok: false, reason: "rejected", message: rejected };
      if ((git.repos[side].get(ref) ?? null) !== expected) return { ok: false, reason: "lease", message: "stale info" };
      if (sha === null) git.repos[side].delete(ref);
      else git.repos[side].set(ref, sha);
      return { ok: true };
    },
  };
  return git;
}
