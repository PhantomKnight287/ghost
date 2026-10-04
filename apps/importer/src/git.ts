import { PermanentImportError } from "./errors.ts";

const GITHUB = "https://github.com";

// What an import carries over. `refs/pull/*/head` keeps every pull request's commits, including ones whose branch is gone or lived in a fork.
const REFSPECS = ["refs/heads/*", "refs/tags/*", "refs/pull/*/head"];

/** Credentials go in through the environment rather than argv, where any local user could read them from `ps`, and are scoped to one origin so a redirect cannot carry them elsewhere. */
export function credentialEnv(
  origin: string,
  username: string,
  password: string,
) {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${origin}/.extraHeader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`,
  };
}

async function git(
  args: string[],
  {
    env = {},
    signal,
    stdin,
  }: { env?: Record<string, string>; signal: AbortSignal; stdin?: string },
) {
  const child = Bun.spawn(["git", ...args], {
    env: { ...process.env, ...env },
    stdin: stdin === undefined ? "ignore" : new TextEncoder().encode(stdin),
    stdout: "pipe",
    stderr: "pipe",
    signal,
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0)
    throw new Error(
      `git ${args.join(" ")} exited with ${code}: ${stderr.trim()}`,
    );
  return stdout;
}

export async function fetchFromGitHub({
  dir,
  source,
  token,
  tokenWorked,
  signal,
}: {
  dir: string;
  source: string;
  token: string;
  /** GitHub has already accepted `token` in this attempt, so a refusal now means it expired rather than that it never worked. */
  tokenWorked: boolean;
  signal: AbortSignal;
}) {
  await git(["init", "--bare", "--quiet", dir], { signal });
  await git(
    [
      "-C",
      dir,
      "fetch",
      "--quiet",
      "--no-tags",
      `${GITHUB}/${source}.git`,
      ...REFSPECS.map((spec) => `+${spec}:${spec}`),
    ],
    { env: credentialEnv(GITHUB, "x-access-token", token), signal },
  ).catch((error: Error) => {
    throw fetchFailure(error, tokenWorked);
  });
}

/** Whether a failed fetch is worth another attempt. No access stays no access; a token that expired mid-attempt is replaced by the next one. */
export function fetchFailure(error: Error, tokenWorked: boolean) {
  if (tokenWorked && /Authentication failed/.test(error.message))
    return new Error(
      `${error.message} (the GitHub token expired during the import)`,
    );
  if (/Repository not found|Authentication failed|403/.test(error.message))
    return new PermanentImportError(error.message);
  return error;
}

export async function listRefs(
  dir: string,
  signal: AbortSignal,
): Promise<Set<string>> {
  const output = await git(["-C", dir, "for-each-ref", "--format=%(refname)"], {
    signal,
  });
  return new Set(output.split("\n").filter(Boolean));
}

/** Which of `shas` the fetched history holds. GitHub reports merge commits that a later force-push left unreachable. */
export async function presentCommits(
  dir: string,
  shas: string[],
  signal: AbortSignal,
): Promise<Set<string>> {
  if (!shas.length) return new Set();
  const output = await git(
    ["-C", dir, "cat-file", "--batch-check=%(objectname) %(objecttype)"],
    { signal, stdin: `${shas.join("\n")}\n` },
  );
  return new Set(
    output
      .split("\n")
      .map((line) => line.split(" "))
      .filter(([, type]) => type === "commit")
      .map(([sha]) => sha!),
  );
}

/** One push of every imported ref, named by pattern so argv stays small however many pull requests there are. Not forced: refs a previous attempt already pushed are up to date, and anything else on the other side is a conflict worth failing on. */
export async function pushToGhost({
  dir,
  apiUrl,
  destination,
  token,
  signal,
}: {
  dir: string;
  apiUrl: string;
  destination: string;
  token: string;
  signal: AbortSignal;
}) {
  const origin = new URL(apiUrl).origin;
  await git(
    [
      "-C",
      dir,
      "push",
      "--quiet",
      `${origin}/${destination}.git`,
      ...REFSPECS.map((spec) => `${spec}:${spec}`),
    ],
    { env: credentialEnv(origin, "import", token), signal },
  );
}
