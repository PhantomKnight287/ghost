// Drives a running self-hosted Ghost from the outside, the way a user would:
// sign up, verify by email, push and clone over HTTP and SSH, organizations,
// issues, a merged pull request, a signed webhook, and code search.
// Reads the addresses from docker/.env; E2E_API, E2E_WEB, E2E_DOCS,
// E2E_SSH_PORT, E2E_MAILPIT and E2E_HOOKS override them when ports are remapped.
import { execFileSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.match(/^([A-Z0-9_]+)='(.*)'$/))
    .filter(Boolean)
    .map(([, key, value]) => [key, value]),
);
const API = process.env.E2E_API ?? env.API_URL;
const WEB = process.env.E2E_WEB ?? env.WEB_APP_URL;
const DOCS = process.env.E2E_DOCS ?? env.DOCS_URL;
const MAILPIT = process.env.E2E_MAILPIT ?? 'http://127.0.0.1:8025';
const HOOKS = process.env.E2E_HOOKS ?? 'http://127.0.0.1:38090';
const [sshHost, sshPort] = env.SSH_CLONE_HOST.split(':');
const SSH = `ssh://git@${sshHost}:${process.env.E2E_SSH_PORT ?? sshPort}`;

const stamp = Date.now().toString(36);
const username = `e2e${stamp}`;
const email = `${username}@example.com`;
const password = 'correct horse battery staple';
const org = `org${stamp}`;
// A word nothing else contains, so code search can only find it in the pushed file.
const needle = `needle${stamp}`;
const work = mkdtempSync(join(tmpdir(), 'ghost-e2e-'));
let cookie = '';

/** Resolve after the given delay in milliseconds. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** Run a named check, logging its duration or exiting with status 1 on failure. */
async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    console.log(`ok   ${name} (${Date.now() - started}ms)`);
  } catch (error) {
    console.error(`FAIL ${name}\n${error.stack ?? error}`);
    process.exit(1);
  }
}
/** Throw an error with the supplied message when the condition is falsy. */
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
/**
 * Poll every two seconds until fn returns a truthy value, then return that value.
 * Retry rejected checks and include the last caught error if the deadline expires.
 */
async function until(what, fn, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      last = error;
    }
    await sleep(2000);
  }
  throw new Error(`timed out waiting for ${what}${last ? `: ${last.message}` : ''}`);
}
/**
 * Send JSON with the current session cookie and configured web origin, without following redirects.
 * Check the expected status and return headers, text, and JSON when parsing succeeds.
 */
async function call(method, path, body, { expect = [200, 201], base = API } = {}) {
  const res = await fetch(base + path, {
    method,
    redirect: 'manual',
    headers: {
      'content-type': 'application/json',
      // Better Auth refuses cookie requests from an origin it does not trust.
      origin: env.WEB_APP_URL,
      ...(cookie && { cookie }),
    },
    body: body && JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {}
  assert(
    [expect].flat().includes(res.status),
    `${method} ${path}: expected ${expect}, got ${res.status} ${text.slice(0, 500)}`,
  );
  return { status: res.status, headers: res.headers, json, text };
}
/** Run Git in cwd with the test identity and SSH key, returning trimmed stdout or throwing on failure. */
function git(cwd, ...args) {
  return execFileSync(
    'git',
    ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
    {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_SSH_COMMAND: sshCommand },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ).trim();
}
/** Write and commit a repository file, returning the resulting HEAD commit hash. */
function commit(dir, file, content, message) {
  writeFileSync(join(dir, file), content);
  git(dir, 'add', file);
  git(dir, 'commit', '-q', '-m', message);
  return git(dir, 'rev-parse', 'HEAD');
}
/** Return the first Mailpit search result for a recipient, or undefined if none is found. */
async function latestMail(to) {
  const { messages } = await (
    await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)
  ).json();
  return messages?.[0];
}

const keyFile = join(work, 'id_ed25519');
const sshCommand = `ssh -i ${keyFile} -o IdentitiesOnly=yes -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR`;
let apiKey = '';
let httpRemote = '';

try {
  await step('api, web and docs answer', async () => {
    await until('the api', async () => (await fetch(`${API}/api`)).ok, 300_000);
    await until('the web app', async () => (await fetch(WEB)).ok);
    await until('the docs', async () => (await fetch(`${DOCS}/self-hosting`)).ok);
  });

  await step('sign up', async () => {
    const { json } = await call('POST', '/api/auth/sign-up/email', {
      email,
      password,
      name: 'E2E',
      username,
    });
    assert(!json.token, 'verification is on, so sign-up must not start a session');
  });

  await step('sign-in is refused until the email is verified', async () => {
    await call('POST', '/api/auth/sign-in/email', { email, password }, { expect: 403 });
  });

  await step('verify through the emailed link', async () => {
    const message = await until('the verification email', () => latestMail(email));
    assert(message.Subject === 'Verify your email', `unexpected subject ${message.Subject}`);
    const { Text } = await (await fetch(`${MAILPIT}/api/v1/message/${message.ID}`)).json();
    const link = Text.match(/https?:\/\/\S*verify-email\?token=[^\s)\]"]+/)?.[0];
    assert(link, `no verification link in:\n${Text}`);
    const url = new URL(link);
    const res = await call('GET', url.pathname + url.search, undefined, { expect: 302 });
    assert(
      res.headers.get('location')?.startsWith(env.WEB_APP_URL),
      `verification redirected to ${res.headers.get('location')}`,
    );
  });

  await step('sign in', async () => {
    const res = await call('POST', '/api/auth/sign-in/email', { email, password });
    cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    assert(cookie.includes('session_token'), `no session cookie: ${cookie}`);
    const { json } = await call('GET', '/api/auth/get-session');
    assert(json.user.emailVerified === true, 'account is not verified');
  });

  await step('the web app sees the session when rendering', async () => {
    const res = await fetch(WEB, { headers: { cookie }, redirect: 'manual' });
    assert(
      res.headers.get('location')?.endsWith('/dashboard'),
      `signed-in home page answered ${res.status} ${res.headers.get('location')}`,
    );
  });

  await step('create an API key', async () => {
    const { json } = await call('POST', '/api/auth/api-key/create', { name: 'e2e' });
    apiKey = json.key;
    assert(apiKey?.startsWith('ghost_pat_'), `unexpected key ${apiKey}`);
    httpRemote = `${API.replace('://', `://${username}:${apiKey}@`)}/${username}/hello.git`;
  });

  await step('create a repository', async () => {
    const { json } = await call('POST', '/api/repositories', { name: 'hello', visibility: 'public' });
    assert(json.slug === 'hello', `slug ${json.slug}`);
  });

  let secret = '';
  /** Wait for this run's webhook event and return its headers and decoded body. */
  const delivery = (event) =>
    until(`a ${event} delivery`, async () => {
      const all = await (await fetch(`${HOOKS}/deliveries`)).json();
      // The receiver outlives a run; only this run's account is in its payloads.
      return all
        .map((h) => ({ ...h, body: Buffer.from(h.body, 'base64') }))
        .find((h) => h.headers['x-ghost-event'] === event && h.body.includes(username));
    });

  await step('add a webhook', async () => {
    const { json } = await call('POST', `/api/repositories/${username}/hello/webhooks`, {
      url: 'http://hooks:8080/hook',
      events: ['push', 'issue.opened'],
    });
    secret = json.secret;
    assert(secret, 'no signing secret returned');
  });

  const local = join(work, 'hello');
  let head = '';
  await step('push over HTTP', async () => {
    git(work, 'init', '-q', '-b', 'main', 'hello');
    commit(local, 'README.md', '# hello\n', 'first');
    head = commit(local, 'search.txt', `the ${needle} is here\n`, 'add a needle');
    git(local, 'remote', 'add', 'origin', httpRemote);
    git(local, 'push', '-q', 'origin', 'main');
  });

  await step('clone over HTTP', async () => {
    git(work, 'clone', '-q', httpRemote, 'hello-clone');
    assert(git(join(work, 'hello-clone'), 'rev-parse', 'HEAD') === head, 'cloned HEAD differs');
  });

  await step('the push reaches the webhook, signed', async () => {
    const hook = await delivery('push');
    const ts = hook.headers['x-ghost-timestamp'];
    const expected = `sha256=${createHmac('sha256', secret).update(`${ts}.`).update(hook.body).digest('hex')}`;
    assert(hook.headers['x-ghost-signature-256'] === expected, 'signature does not verify');
  });

  await step('the web app renders the repository', async () => {
    const res = await fetch(`${WEB}/${username}/hello`);
    const html = await res.text();
    assert(res.ok, `web returned ${res.status}`);
    assert(html.includes('search.txt'), 'repository page does not list the pushed file');
  });

  await step('open an issue', async () => {
    const { json } = await call('POST', `/api/repositories/${username}/hello/issues`, {
      title: 'Something is off',
      body: 'Opened by e2e.mjs',
    });
    assert(json.number === 1, `issue number ${json.number}`);
    await delivery('issue.opened');
  });

  await step('open and merge a pull request', async () => {
    git(local, 'checkout', '-q', '-b', 'feature');
    commit(local, 'feature.txt', 'a feature\n', 'add a feature');
    git(local, 'push', '-q', 'origin', 'feature');
    const { json: pr } = await call('POST', `/api/repositories/${username}/hello/pulls`, {
      title: 'Add a feature',
      base: 'main',
      head: 'feature',
    });
    await until('a mergeable pull request', async () => {
      const res = await call(
        'POST',
        `/api/repositories/${username}/hello/pulls/${pr.number}/merge`,
        {},
        { expect: [200, 201, 409] },
      );
      return res.status !== 409;
    });
    git(local, 'fetch', '-q', 'origin');
    const files = git(local, 'ls-tree', '--name-only', 'origin/main');
    assert(files.includes('feature.txt'), `main after merge: ${files}`);
    const merge = git(local, 'rev-parse', 'origin/main');
    const { json: mergeCommit } = await call('GET', `/api/repositories/${username}/hello/commits/${merge}`);
    assert(mergeCommit.verification?.verified, `merge commit verification: ${JSON.stringify(mergeCommit.verification)}`);
  });

  await step('create an organization and a repository in it', async () => {
    await call('POST', '/api/auth/organization/create', { name: 'E2E Org', slug: org });
    const { json } = await call('POST', '/api/repositories', { name: 'widget', organization: org });
    assert(json.slug === 'widget', `slug ${json.slug}`);
  });

  await step('push over SSH', async () => {
    execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', keyFile]);
    await call('POST', '/api/ssh-keys', {
      title: 'e2e',
      publicKey: readFileSync(`${keyFile}.pub`, 'utf8').trim(),
    });
    const dir = join(work, 'widget');
    git(work, 'init', '-q', '-b', 'main', 'widget');
    head = commit(dir, 'widget.txt', 'widget\n', 'first');
    git(dir, 'push', '-q', `${SSH}/${org}/widget.git`, 'main');
  });

  await step('clone over SSH', async () => {
    git(work, 'clone', '-q', `${SSH}/${org}/widget.git`, 'widget-clone');
    assert(git(join(work, 'widget-clone'), 'rev-parse', 'HEAD') === head, 'cloned HEAD differs');
  });

  await step('code search finds the pushed file', async () => {
    await until(
      'the needle in search results',
      async () => {
        const { json } = await call('GET', `/api/search/code?q=${needle}`);
        return json.files.some((f) => f.repository.slug === 'hello');
      },
      180_000,
    );
  });

  await step('repository search finds the repository', async () => {
    const { text } = await call('GET', `/api/search/repositories?q=hello`);
    assert(text.includes(username), 'repository search missed the new repository');
  });

  console.log('\nall checks passed');
} finally {
  rmSync(work, { recursive: true, force: true });
}
