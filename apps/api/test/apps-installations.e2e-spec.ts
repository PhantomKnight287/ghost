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
});
