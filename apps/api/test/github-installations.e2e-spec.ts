import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { App } from '@octokit/app';
import { Octokit } from '@octokit/core';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import {
  hashInstallationToken,
  INSTALLATION_TOKEN,
} from '../src/lib/apps/installation-token.js';
import { hasBackends, signUp, startApp } from './harness.js';

const FORBIDDEN = 'Resource not accessible by integration';

describe.skipIf(!hasBackends)('GitHub installation endpoints', () => {
  let app: INestApplication;
  let db: Database;
  let origin: string;
  let appOwner: { cookie: string; key: string; userId: string };
  let installer: { cookie: string; key: string; userId: string };
  const stamp = Date.now();
  const installerName = `giinstaller${stamp}`;
  const r1 = `gir1${stamp}`;
  const r2 = `gir2${stamp}`;
  let apps = 0;
  const api = () => request(app.getHttpServer());

  /** An app with a key, installed on `installer`'s `r1` only. */
  const installedApp = async () => {
    const { body } = await api()
      .post('/api/apps')
      .set('cookie', appOwner.cookie)
      .send({
        name: `Tokens ${stamp} ${apps++}`,
        homepageUrl: 'https://bot.example',
        permissions: { issues: 'write', contents: 'read' },
        events: [],
      })
      .expect(201);
    const { body: key } = await api()
      .post(`/api/apps/${body.slug}/private-keys`)
      .set('cookie', appOwner.cookie)
      .expect(201);
    const [repository] = await db
      .select({ id: schema.repository.id })
      .from(schema.repository)
      .where(eq(schema.repository.slug, r1));
    const { body: installation } = await api()
      .post(`/api/apps/${body.slug}/installations`)
      .set('cookie', installer.cookie)
      .send({
        account: installerName,
        repositorySelection: 'selected',
        repositoryIds: [repository!.id],
      })
      .expect(201);
    const octokitApp = new App({
      appId: body.appId,
      privateKey: key.privateKey,
      Octokit: Octokit.defaults({ baseUrl: `${origin}/api/v3` }),
    });
    return {
      slug: body.slug as string,
      appId: body.appId as number,
      ghostInstallationId: installation.id as string,
      installationId: installation.installationId as number,
      octokitApp,
    };
  };
  const mint = (
    octokitApp: App,
    installationId: number,
    body: Record<string, unknown> = {},
  ) =>
    octokitApp.octokit.request(
      'POST /app/installations/{installation_id}/access_tokens',
      { installation_id: installationId, ...body },
    );
  const withToken = (token: string) => ({
    get: (path: string) =>
      api().get(path).set('authorization', `token ${token}`),
  });

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    db = app.get<Database>(DATABASE);
    appOwner = await signUp(app, `giowner${stamp}`);
    installer = await signUp(app, installerName);
    for (const name of [r1, r2])
      await api()
        .post('/api/repositories')
        .set('cookie', installer.cookie)
        .send({ name, visibility: 'private' })
        .expect(201);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('lists and reads installations', async () => {
    const { octokitApp, installationId, slug, appId } = await installedApp();

    const { data: list } = await octokitApp.octokit.request(
      'GET /app/installations',
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: installationId,
      account: { login: installerName, type: 'User' },
      app_id: appId,
      app_slug: slug,
      target_type: 'User',
      repository_selection: 'selected',
      permissions: { metadata: 'read', issues: 'write', contents: 'read' },
      suspended_at: null,
    });
    const { data: one } = await octokitApp.octokit.request(
      'GET /app/installations/{installation_id}',
      { installation_id: installationId },
    );
    expect(one.id).toBe(installationId);
    const { data: self } = await octokitApp.octokit.request('GET /app');
    expect(self?.installations_count).toBe(1);
  });

  it('finds the installation of a repository, user and organization', async () => {
    const { octokitApp, installationId } = await installedApp();

    const { data: byRepository } = await octokitApp.octokit.request(
      'GET /repos/{owner}/{repo}/installation',
      { owner: installerName, repo: r1 },
    );
    expect(byRepository.id).toBe(installationId);
    const { data: byUser } = await octokitApp.octokit.request(
      'GET /users/{username}/installation',
      { username: installerName },
    );
    expect(byUser.id).toBe(installationId);
    await expect(
      octokitApp.octokit.request('GET /repos/{owner}/{repo}/installation', {
        owner: installerName,
        repo: r2,
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      octokitApp.octokit.request('GET /orgs/{org}/installation', {
        org: `nobody${stamp}`,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('mints a token Octokit uses', async () => {
    const { octokitApp, installationId, ghostInstallationId } =
      await installedApp();

    const installed = await octokitApp.getInstallationOctokit(installationId);
    const { data } = await installed.request('GET /installation/repositories');
    expect(data.total_count).toBe(1);
    expect(data.repository_selection).toBe('selected');
    expect(data.repositories.map((repository) => repository.name)).toEqual([
      r1,
    ]);

    const { data: minted, status } = await mint(octokitApp, installationId);
    expect(status).toBe(201);
    expect(minted.token).toMatch(INSTALLATION_TOKEN);
    expect(
      Math.abs(Date.parse(minted.expires_at) - (Date.now() + 3_600_000)),
    ).toBeLessThan(60_000);
    expect(minted.permissions).toEqual({
      metadata: 'read',
      issues: 'write',
      contents: 'read',
    });
    const rows = await db
      .select({ tokenHash: schema.appInstallationToken.tokenHash })
      .from(schema.appInstallationToken)
      .where(
        eq(schema.appInstallationToken.installationId, ghostInstallationId),
      );
    expect(rows.map((row) => row.tokenHash)).toContain(
      hashInstallationToken(minted.token),
    );
    expect(JSON.stringify(rows)).not.toContain(minted.token);
  });

  it('narrows a token', async () => {
    const { octokitApp, installationId } = await installedApp();

    const { data: narrowed } = await mint(octokitApp, installationId, {
      permissions: { issues: 'read' },
    });
    expect(narrowed.permissions).toEqual({ metadata: 'read', issues: 'read' });
    await expect(
      mint(octokitApp, installationId, { repositories: [r2] }),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        data: {
          message:
            'There is at least one repository that does not exist or is not accessible to the parent installation.',
        },
      },
    });
    await expect(
      mint(octokitApp, installationId, {
        permissions: { issues: 'write', statuses: 'write' },
      }),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        data: {
          message:
            'The permissions requested are not granted to this installation.',
        },
      },
    });
  });

  it("refuses another app's installation", async () => {
    const { installationId } = await installedApp();
    const { octokitApp: stranger } = await installedApp();

    await expect(mint(stranger, installationId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      stranger.octokit.request('GET /app/installations/{installation_id}', {
        installation_id: installationId,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses a suspended installation', async () => {
    const { octokitApp, installationId, ghostInstallationId } =
      await installedApp();
    const { data: before } = await mint(octokitApp, installationId);

    await api()
      .put(`/api/installations/${ghostInstallationId}/suspended`)
      .set('cookie', installer.cookie)
      .expect(204);

    await expect(mint(octokitApp, installationId)).rejects.toMatchObject({
      status: 403,
      response: { data: { message: 'This installation has been suspended' } },
    });
    const { body } = await withToken(before.token)
      .get('/api/v3/installation/repositories')
      .expect(401);
    expect(body.message).toBe('Bad credentials');
  });

  it('expires a token', async () => {
    const { octokitApp, installationId } = await installedApp();
    const { data } = await mint(octokitApp, installationId);

    await db
      .update(schema.appInstallationToken)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(
        eq(
          schema.appInstallationToken.tokenHash,
          hashInstallationToken(data.token),
        ),
      );

    await withToken(data.token)
      .get('/api/v3/installation/repositories')
      .expect(401);
  });

  it('an app uninstalls itself', async () => {
    const { octokitApp, installationId, ghostInstallationId } =
      await installedApp();
    const { data } = await mint(octokitApp, installationId);

    const { status } = await octokitApp.octokit.request(
      'DELETE /app/installations/{installation_id}',
      { installation_id: installationId },
    );
    expect(status).toBe(204);

    const { body } = await api()
      .get('/api/installations')
      .set('cookie', installer.cookie)
      .expect(200);
    expect(
      body.installations.some(
        (row: { id: string }) => row.id === ghostInstallationId,
      ),
    ).toBe(false);
    await withToken(data.token)
      .get('/api/v3/installation/repositories')
      .expect(401);
  });

  it("refuses a token on GraphQL and on Ghost's API", async () => {
    const { octokitApp, installationId } = await installedApp();
    const { data } = await mint(octokitApp, installationId);

    const { body } = await api()
      .post('/api/graphql')
      .set('authorization', `bearer ${data.token}`)
      .send({ query: '{ viewer { login } }' })
      .expect(403);
    expect(body.message).toBe(FORBIDDEN);
    await api()
      .get('/api/notifications')
      .set('authorization', `Bearer ${data.token}`)
      .expect(401);
  });

  it('refuses a token as a JWT and a JWT as a token', async () => {
    const { octokitApp, installationId } = await installedApp();
    const { data } = await mint(octokitApp, installationId);

    const { body: asJwt } = await withToken(data.token)
      .get('/api/v3/app/installations')
      .expect(401);
    expect(asJwt.message).toBe('A JSON web token could not be decoded');
    const { token: jwt } = (await octokitApp.octokit.auth({
      type: 'app',
    })) as { token: string };
    const { body: asToken } = await api()
      .get('/api/v3/installation/repositories')
      .set('authorization', `Bearer ${jwt}`)
      .expect(403);
    expect(asToken.message).toBe(FORBIDDEN);
  });

  it('accepts a token as a git password', async () => {
    const { octokitApp, installationId } = await installedApp();
    const { data } = await mint(octokitApp, installationId);
    const basic = Buffer.from(`x-access-token:${data.token}`).toString(
      'base64',
    );

    await api()
      .get(`/${installerName}/${r1}.git/info/refs?service=git-upload-pack`)
      .set('authorization', `Basic ${basic}`)
      .expect(200);
  });
});
