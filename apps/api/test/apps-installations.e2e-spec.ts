import { randomBytes } from 'node:crypto';

import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

describe.skipIf(!hasBackends)('Ghost App installations', () => {
  let app: INestApplication;
  let db: Database;
  let appOwner: { cookie: string; key: string; userId: string };
  let installer: { cookie: string; key: string; userId: string };
  const stamp = Date.now();
  let apps = 0;
  const api = () => request(app.getHttpServer());
  const auth = () => app.get<AuthService<Auth>>(AuthService).api;
  const register = async (body: object = {}) =>
    (
      await api()
        .post('/api/apps')
        .set('cookie', appOwner.cookie)
        .send({
          name: `Inst ${stamp} ${apps++}`,
          homepageUrl: 'https://bot.example',
          permissions: { issues: 'write' },
          events: ['issue.opened'],
          ...body,
        })
        .expect(201)
    ).body as { id: string; slug: string; appId: number };
  const createRepository = async (
    cookie: string,
    name: string,
    visibility = 'private',
  ) => {
    await api()
      .post('/api/repositories')
      .set('cookie', cookie)
      .send({ name, visibility })
      .expect(201);
    const [row] = await db
      .select({ id: schema.repository.id })
      .from(schema.repository)
      .where(eq(schema.repository.slug, name));
    return row!.id;
  };
  const insertToken = (installationId: string, permissions = {}) =>
    db.insert(schema.appInstallationToken).values({
      installationId,
      tokenHash: randomBytes(32).toString('hex'),
      permissions,
      expiresAt: new Date(Date.now() + 3_600_000),
    });
  const tokensOf = (installationId: string) =>
    db
      .select({ id: schema.appInstallationToken.id })
      .from(schema.appInstallationToken)
      .where(eq(schema.appInstallationToken.installationId, installationId));

  beforeAll(async () => {
    ({ app } = await startApp({
      WEBHOOK_SECRET_KEY: randomBytes(32).toString('base64'),
    }));
    db = app.get<Database>(DATABASE);
    appOwner = await signUp(app, `inowner${stamp}`);
    installer = await signUp(app, `ininstaller${stamp}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('schema', () => {
    it('refuses an installation with no account or two accounts', async () => {
      const { id: appId } = await register();
      const organizationId = (await auth().createOrganization({
        body: { name: 'Schema Org', slug: `inschema${stamp}` },
        headers: new Headers({ cookie: installer.cookie }),
      }))!.id;
      const values = {
        appId,
        repositorySelection: 'all' as const,
        permissions: {},
        events: [],
      };

      await expect(
        db.insert(schema.appInstallation).values(values),
      ).rejects.toThrow();
      await expect(
        db.insert(schema.appInstallation).values({
          ...values,
          accountUserId: installer.userId,
          accountOrganizationId: organizationId,
        }),
      ).rejects.toThrow();
    });

    it('refuses a second installation of an app on one account', async () => {
      const { id: appId } = await register();
      const values = {
        appId,
        accountUserId: installer.userId,
        repositorySelection: 'all' as const,
        permissions: {},
        events: [],
      };
      await db.insert(schema.appInstallation).values(values);

      await expect(
        db.insert(schema.appInstallation).values(values),
      ).rejects.toThrow();
    });

    it('drops installations with their organization', async () => {
      const { id: appId } = await register();
      const organizationId = (await auth().createOrganization({
        body: { name: 'Doomed Org', slug: `indoomed${stamp}` },
        headers: new Headers({ cookie: installer.cookie }),
      }))!.id;
      const [installation] = await db
        .insert(schema.appInstallation)
        .values({
          appId,
          accountOrganizationId: organizationId,
          repositorySelection: 'all',
          permissions: {},
          events: [],
        })
        .returning({ id: schema.appInstallation.id });
      await insertToken(installation!.id);

      await auth().deleteOrganization({
        body: { organizationId },
        headers: new Headers({ cookie: installer.cookie }),
      });

      expect(
        await db
          .select()
          .from(schema.appInstallation)
          .where(eq(schema.appInstallation.id, installation!.id)),
      ).toEqual([]);
      expect(await tokensOf(installation!.id)).toEqual([]);
    });

    it('refuses an Integration bypass actor without an app', async () => {
      const repositoryId = await createRepository(
        installer.cookie,
        `inbypass${stamp}`,
      );
      const [ruleset] = await db
        .insert(schema.ruleset)
        .values({ repositoryId, name: 'Bypass', target: 'branch' })
        .returning({ id: schema.ruleset.id });

      await expect(
        db.insert(schema.rulesetBypassActor).values({
          rulesetId: ruleset!.id,
          actorType: 'Integration',
          bypassMode: 'always',
        }),
      ).rejects.toThrow();
      const { id: appId } = await register();
      await db.insert(schema.rulesetBypassActor).values({
        rulesetId: ruleset!.id,
        actorType: 'Integration',
        appId,
        bypassMode: 'always',
      });
      const rows = await db
        .select()
        .from(schema.rulesetBypassActor)
        .where(
          and(
            eq(schema.rulesetBypassActor.rulesetId, ruleset!.id),
            eq(schema.rulesetBypassActor.appId, appId),
          ),
        );
      expect(rows).toHaveLength(1);
    });
  });
  describe('installing', () => {
    let r1: string;
    let r2: string;
    let foreign: string;
    let other: { cookie: string; key: string; userId: string };
    const installerName = () => `ininstaller${stamp}`;
    const install = (slug: string, body: object, cookie = installer.cookie) =>
      api()
        .post(`/api/apps/${slug}/installations`)
        .set('cookie', cookie)
        .send(body);
    const installation = (id: string, cookie = installer.cookie) =>
      api()
        .get('/api/installations')
        .set('cookie', cookie)
        .then(
          ({ body }) =>
            (body.installations as { id: string }[]).find(
              (row) => row.id === id,
            ) as Record<string, unknown> | undefined,
        );

    beforeAll(async () => {
      other = await signUp(app, `inother${stamp}`);
      r1 = await createRepository(installer.cookie, `inr1${stamp}`);
      r2 = await createRepository(installer.cookie, `inr2${stamp}`);
      foreign = await createRepository(other.cookie, `inforeign${stamp}`);
    });

    it('installs on all repositories', async () => {
      const { slug } = await register();
      const { body } = await install(slug, {
        account: installerName(),
        repositorySelection: 'all',
      }).expect(201);

      expect(body).toMatchObject({
        id: expect.any(String),
        installationId: expect.any(Number),
        app: { slug },
        account: { login: installerName(), type: 'user' },
        repositorySelection: 'all',
        repositories: [],
        permissions: { metadata: 'read', issues: 'write' },
        events: ['issue.opened'],
        suspendedAt: null,
      });
      expect(body.redirectUrl).toMatch(/\/settings\/installations$/);
    });

    it('installs on selected repositories', async () => {
      const { slug } = await register();
      const { body } = await install(slug, {
        account: installerName(),
        repositorySelection: 'selected',
        repositoryIds: [r1],
      }).expect(201);

      expect(body.repositories).toEqual([
        { id: r1, fullName: `${installerName()}/inr1${stamp}` },
      ]);
    });

    it('redirects to the setup URL', async () => {
      const { slug } = await register();
      await api()
        .patch(`/api/apps/${slug}`)
        .set('cookie', appOwner.cookie)
        .send({ setupUrl: 'https://ci.example/setup' })
        .expect(200);

      const { body } = await install(slug, {
        account: installerName(),
        repositorySelection: 'all',
      }).expect(201);

      expect(body.redirectUrl).toBe(
        `https://ci.example/setup?installation_id=${body.installationId}&setup_action=install`,
      );
    });

    it('refuses repositories the account does not own', async () => {
      const { slug } = await register();
      await install(slug, {
        account: installerName(),
        repositorySelection: 'selected',
        repositoryIds: [foreign],
      }).expect(422);
      await install(slug, {
        account: installerName(),
        repositorySelection: 'selected',
      }).expect(400);
    });

    it('refuses a second install on one account', async () => {
      const { slug } = await register();
      const body = { account: installerName(), repositorySelection: 'all' };
      await install(slug, body).expect(201);

      const { body: refused } = await install(slug, body).expect(422);
      expect(refused.message).toBe(
        'This app is already installed on that account',
      );
    });

    it('refuses an account the caller does not hold', async () => {
      const { slug } = await register();
      await install(slug, {
        account: `inother${stamp}`,
        repositorySelection: 'all',
      }).expect(404);
    });

    it('installs on an organization the caller admins', async () => {
      const org = `inorg${stamp}`;
      const member = await signUp(app, `inmember${stamp}`);
      const organizationId = (await auth().createOrganization({
        body: { name: 'Install Org', slug: org },
        headers: new Headers({ cookie: installer.cookie }),
      }))!.id;
      await auth().addMember({
        body: { userId: member.userId, role: 'member', organizationId },
      });
      const { slug } = await register();

      await install(
        slug,
        { account: org, repositorySelection: 'all' },
        member.cookie,
      ).expect(403);
      const { body } = await install(slug, {
        account: org,
        repositorySelection: 'all',
      }).expect(201);
      expect(body.account).toEqual({ login: org, type: 'organization' });

      const { body: listed } = await api()
        .get(`/api/organizations/${org}/installations`)
        .set('cookie', installer.cookie)
        .expect(200);
      expect(listed.installations.map((row: { id: string }) => row.id)).toEqual(
        [body.id],
      );
    });

    it('reconfigures repositories', async () => {
      const { slug } = await register();
      const { body } = await install(slug, {
        account: installerName(),
        repositorySelection: 'selected',
        repositoryIds: [r1],
      }).expect(201);

      const { body: narrowed } = await api()
        .patch(`/api/installations/${body.id}`)
        .set('cookie', installer.cookie)
        .send({ repositorySelection: 'selected', repositoryIds: [r2] })
        .expect(200);
      expect(
        narrowed.repositories.map((row: { id: string }) => row.id),
      ).toEqual([r2]);
      const { body: widened } = await api()
        .patch(`/api/installations/${body.id}`)
        .set('cookie', installer.cookie)
        .send({ repositorySelection: 'all' })
        .expect(200);
      expect(widened).toMatchObject({
        repositorySelection: 'all',
        repositories: [],
      });
    });

    it('suspends and unsuspends', async () => {
      const { slug } = await register();
      const { body } = await install(slug, {
        account: installerName(),
        repositorySelection: 'all',
      }).expect(201);
      await insertToken(body.id);

      await api()
        .put(`/api/installations/${body.id}/suspended`)
        .set('cookie', installer.cookie)
        .expect(204);
      expect((await installation(body.id))?.suspendedAt).toEqual(
        expect.any(String),
      );
      expect(await tokensOf(body.id)).toEqual([]);

      await api()
        .delete(`/api/installations/${body.id}/suspended`)
        .set('cookie', installer.cookie)
        .expect(204);
      expect((await installation(body.id))?.suspendedAt).toBeNull();
    });

    it('uninstalls', async () => {
      const { slug } = await register();
      const { body } = await install(slug, {
        account: installerName(),
        repositorySelection: 'all',
      }).expect(201);
      await insertToken(body.id);

      await api()
        .delete(`/api/installations/${body.id}`)
        .set('cookie', installer.cookie)
        .expect(204);

      expect(await installation(body.id)).toBeUndefined();
      expect(await tokensOf(body.id)).toEqual([]);
    });

    it("hides another account's installation", async () => {
      const { slug } = await register();
      const { body } = await install(slug, {
        account: installerName(),
        repositorySelection: 'all',
      }).expect(201);

      await api()
        .patch(`/api/installations/${body.id}`)
        .set('cookie', appOwner.cookie)
        .send({ repositorySelection: 'all' })
        .expect(404);
      await api()
        .put(`/api/installations/${body.id}/suspended`)
        .set('cookie', appOwner.cookie)
        .expect(404);
      await api()
        .delete(`/api/installations/${body.id}`)
        .set('cookie', appOwner.cookie)
        .expect(404);
    });

    it('refuses raising permissions while installed', async () => {
      const { slug } = await register();
      await install(slug, {
        account: installerName(),
        repositorySelection: 'all',
      }).expect(201);
      const message =
        "Remove this app's installations before asking for more permissions or events";

      const { body: more } = await api()
        .patch(`/api/apps/${slug}`)
        .set('cookie', appOwner.cookie)
        .send({ permissions: { issues: 'write', contents: 'read' } })
        .expect(422);
      expect(more.message).toBe(message);
      const { body: event } = await api()
        .patch(`/api/apps/${slug}`)
        .set('cookie', appOwner.cookie)
        .send({ events: ['issue.opened', 'issue.closed'] })
        .expect(422);
      expect(event.message).toBe(message);
    });

    it('lowers permissions on every installation', async () => {
      const { slug } = await register();
      const { body } = await install(slug, {
        account: installerName(),
        repositorySelection: 'all',
      }).expect(201);
      await insertToken(body.id, { metadata: 'read', issues: 'write' });

      await api()
        .patch(`/api/apps/${slug}`)
        .set('cookie', appOwner.cookie)
        .send({ permissions: { issues: 'read' }, events: [] })
        .expect(200);

      expect(await installation(body.id)).toMatchObject({
        permissions: { metadata: 'read', issues: 'read' },
        events: [],
      });
      expect(await tokensOf(body.id)).toEqual([]);
    });

    it('deleting an app removes its installations', async () => {
      const { slug } = await register();
      const { body } = await install(slug, {
        account: installerName(),
        repositorySelection: 'all',
      }).expect(201);
      await insertToken(body.id);

      await api()
        .delete(`/api/apps/${slug}`)
        .set('cookie', appOwner.cookie)
        .expect(204);

      expect(
        await db
          .select()
          .from(schema.appInstallation)
          .where(eq(schema.appInstallation.id, body.id)),
      ).toEqual([]);
      expect(await tokensOf(body.id)).toEqual([]);
    });

    it('counts installations', async () => {
      const { slug } = await register();
      await install(slug, {
        account: installerName(),
        repositorySelection: 'all',
      }).expect(201);

      const { body } = await api()
        .get(`/api/apps/${slug}/settings`)
        .set('cookie', appOwner.cookie)
        .expect(200);
      expect(body.installationsCount).toBe(1);
    });
  });
});
