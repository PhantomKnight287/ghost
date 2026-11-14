import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function run(cwd: string, ...args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
  });
  if (result.exitCode !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
}

/** A bare repository standing in for one host, and a work tree that commits and pushes to it as a person would. */
export function hostRepo(name: string) {
  const root = mkdtempSync(join(tmpdir(), `sync-${name}-`));
  const bare = join(root, "bare.git");
  const work = join(root, "work");
  run(root, "init", "--bare", "--quiet", "--initial-branch=main", bare);
  run(root, "clone", "--quiet", bare, work);
  return {
    url: `file://${bare}`,
    bare,
    /** Commits on `branch` (creating it from the current HEAD if missing) and pushes, as a person would. Returns the sha. */
    commit(branch: string, message: string) {
      run(work, "checkout", "--quiet", "-B", branch);
      run(work, "commit", "--quiet", "--allow-empty", "-m", message);
      run(work, "push", "--quiet", "--force", "origin", `${branch}:refs/heads/${branch}`);
      return run(work, "rev-parse", "HEAD");
    },
    /** Fetches another host's history in, so its commits exist here too. */
    fetchFrom(other: { bare: string }) {
      run(work, "fetch", "--quiet", other.bare, "+refs/heads/*:refs/remotes/other/*");
    },
    /** Moves the work tree to the host's current `branch`, as `git pull` would before a person commits. */
    pull(branch: string) {
      run(work, "fetch", "--quiet", "origin");
      run(work, "checkout", "--quiet", "-B", branch, `origin/${branch}`);
    },
    checkout(ref: string) {
      run(work, "checkout", "--quiet", "--detach", ref);
    },
    ref(name: string) {
      const result = Bun.spawnSync(["git", "rev-parse", "--verify", "--quiet", name], { cwd: bare });
      return result.exitCode === 0 ? result.stdout.toString().trim() : null;
    },
    tag(name: string, sha: string) {
      run(bare, "tag", name, sha);
    },
    rejectPushes(message: string) {
      writeFileSync(join(bare, "hooks", "pre-receive"), `#!/bin/sh\necho "${message}" >&2\nexit 1\n`, { mode: 0o755 });
    },
  };
}

export function scratchDir() {
  return join(mkdtempSync(join(tmpdir(), "sync-mirror-")), "mirror.git");
}
