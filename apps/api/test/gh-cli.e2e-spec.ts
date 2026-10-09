import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GH_E2E_HOST, runGh, tlsFiles } from './gh.js';
import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends || !GH_E2E_HOST)('gh CLI', () => {
  let app: INestApplication;
  let owner: { cookie: string; key: string; userId: string };
  let configDir: string;
  const username = `ghcli${Date.now()}`;
  const gh = (args: string[], input?: string) =>
    runGh(args, { configDir, token: owner.key, input });
  const ok = async (args: string[], input?: string) => {
    const result = await gh(args, input);
    expect(result, result.stderr).toMatchObject({ code: 0 });
    return result.stdout;
  };

  beforeAll(async () => {
    const { key, cert } = tlsFiles();
    ({ app } = await startApp(
      {
        BETTER_AUTH_URL: `https://${GH_E2E_HOST}`,
        WEB_APP_URL: `https://web.${GH_E2E_HOST}`,
      },
      443,
      { key, cert },
    ));
    owner = await signUp(app, username);
    configDir = mkdtempSync(path.join(tmpdir(), 'gh-e2e-'));
  });

  afterAll(async () => {
    await app?.close();
    if (configDir) rmSync(configDir, { recursive: true, force: true });
  });

  it('reaches /api/graphql through gh api graphql', async () => {
    const out = await ok(['api', 'graphql', '-f', 'query={ __typename }']);
    expect(JSON.parse(out)).toEqual({ data: { __typename: 'Query' } });
  });
});
