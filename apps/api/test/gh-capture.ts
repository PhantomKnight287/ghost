import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import { expect } from 'vitest';

/** Where the gh suite records every request gh and the git it runs make; nothing is recorded without it. Fixtures are refreshed from CI's `gh-capture` artifact. */
export const GH_CAPTURE_DIR = process.env.GH_CAPTURE_DIR;

const HEADERS = [
  'accept',
  'content-type',
  'graphql-features',
  'x-github-api-version',
];
const SECRET_FIELD = /secret|token|code|password/i;

type CapturedRequest = {
  method: string;
  path: string;
  query: Record<string, unknown>;
  headers: Record<string, string>;
  body: unknown;
  status: number;
};

const commands: {
  test: string;
  command: string;
  requests: CapturedRequest[];
}[] = [];
let running: (typeof commands)[number] | null = null;

/** Attributes the requests that follow to `gh <args>` until the returned function is called. */
export function capturing(args: string[]) {
  if (!GH_CAPTURE_DIR) return () => {};
  const command = {
    test: expect.getState().currentTestName ?? 'setup',
    command: `gh ${args.join(' ')}`,
    requests: [],
  };
  commands.push(command);
  running = command;
  return () => {
    if (running === command) running = null;
  };
}

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, field]) => [
      key,
      SECRET_FIELD.test(key) ? '<redacted>' : redact(field),
    ]),
  );
}

/** Express middleware recording each gh or git request once its response is sent, when the body parsers have run. Requests the suite makes itself are not gh's and are left out. */
export function recordGhRequests(
  request: Request,
  response: Response,
  next: NextFunction,
) {
  const command = running;
  // Read now: routers mounted under a prefix, such as Apollo's, rewrite the path before the response finishes.
  const requestPath = request.path;
  const agent = request.headers['user-agent'] ?? '';
  if (command && /^(GitHub CLI|git\/)/.test(agent))
    response.on('finish', () => {
      command.requests.push({
        method: request.method,
        path: requestPath,
        query: redact(request.query) as Record<string, unknown>,
        headers: Object.fromEntries(
          HEADERS.flatMap((name) => {
            const value = request.headers[name];
            return typeof value === 'string' ? [[name, value]] : [];
          }),
        ),
        // git's bodies are pack data, not parsed; only what the API parsed is kept.
        body:
          typeof request.body === 'object' &&
          request.body !== null &&
          !Buffer.isBuffer(request.body)
            ? redact(request.body)
            : null,
        status: response.statusCode,
      });
    });
  next();
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** What changes from run to run, or must not be written down, and the placeholder that replaces it, so a refresh only shows what gh changed. */
const placeholders = ({ login, host }: { login: string; host: string }) =>
  [
    [new RegExp(escape(login), 'g'), '<login>'],
    [new RegExp(escape(host), 'g'), '<host>'],
    [new RegExp(`${escape(tmpdir())}/gh-e2e-[^/\\s"]+`, 'g'), '<tmp>'],
    [/\/\/[^/\s"@:]+:[^/\s"@]+@/g, '//<credentials>@'],
    [/ghost_pat_\w+/g, '<token>'],
    [/\b((?:ssh|ecdsa|sk)-[a-z0-9@.-]+) AAAA[A-Za-z0-9+/=]+[^"]*/g, '$1 <key>'],
    [/\b(U|O|R|I|PR|IC|LA|RE|RA)_[A-Za-z0-9_-]{8,}/g, '$1_<id>'],
    [/issues\/comments\/\d+/g, 'issues/comments/<id>'],
    [/releases\/(assets\/)?\d+/g, 'releases/$1<id>'],
  ] as const;

/** Orders a command's requests by what they ask, since gh sends some at once and their arrival order varies. */
const byRequest = (a: CapturedRequest, b: CapturedRequest) =>
  JSON.stringify([a.method, a.path, a.body]).localeCompare(
    JSON.stringify([b.method, b.path, b.body]),
  );

/** Writes one file per test, with `placeholders` applied. */
export function writeGhCapture({
  login,
  host,
}: {
  login: string;
  host: string;
}) {
  if (!GH_CAPTURE_DIR) return;
  mkdirSync(GH_CAPTURE_DIR, { recursive: true });
  for (const test of new Set(commands.map((command) => command.test))) {
    const json = JSON.stringify(
      commands
        .filter((command) => command.test === test)
        .map(({ command, requests }) => ({
          command,
          requests: requests.toSorted(byRequest),
        })),
      null,
      2,
    );
    const replaced = placeholders({ login, host }).reduce(
      (text, [pattern, placeholder]) => text.replace(pattern, placeholder),
      json,
    );
    const name = test
      .split(' > ')
      .at(-1)!
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
    writeFileSync(path.join(GH_CAPTURE_DIR, `${name}.json`), `${replaced}\n`);
  }
}
