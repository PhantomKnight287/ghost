import { createPublicKey, randomBytes } from 'node:crypto';

import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

describe.skipIf(!hasBackends)('Ghost Apps', () => {
  let app: INestApplication;
  let db: Database;
  let owner: { cookie: string; key: string; userId: string };
  let other: { cookie: string; key: string; userId: string };
  const stamp = Date.now();
  const ownerName = `apowner${stamp}`;
  let apps = 0;
  const api = () => request(app.getHttpServer());
  const auth = () => app.get<AuthService<Auth>>(AuthService).api;
  const fresh = () => `Bot ${stamp} ${apps++}`;
  const register = (cookie: string, body: object = {}, path = '/api/apps') =>
    api()
      .post(path)
      .set('cookie', cookie)
      .send({
        name: fresh(),
        homepageUrl: 'https://bot.example',
        permissions: {},
        events: [],
        ...body,
      });
  const settings = (slug: string, cookie = owner.cookie) =>
    api().get(`/api/apps/${slug}/settings`).set('cookie', cookie);
  const generateKey = (slug: string, cookie = owner.cookie) =>
    api().post(`/api/apps/${slug}/private-keys`).set('cookie', cookie);
  const botOf = async (botLogin: string) =>
    (
      await db
        .select({
          id: schema.user.id,
          kind: schema.user.kind,
          name: schema.user.name,
          image: schema.user.image,
        })
        .from(schema.user)
        .where(eq(schema.user.username, botLogin))
    )[0];

  beforeAll(async () => {
    // CI has no WEBHOOK_SECRET_KEY, and an app's webhook secret is sealed with it.
    ({ app } = await startApp({
      WEBHOOK_SECRET_KEY: randomBytes(32).toString('base64'),
    }));
    db = app.get<Database>(DATABASE);
    owner = await signUp(app, ownerName);
    other = await signUp(app, `apother${stamp}`);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registers an app with its bot user', async () => {
    const name = `CI Bot ${stamp}`;
    const { body } = await register(owner.cookie, {
      name,
      description: 'Posts statuses',
      permissions: { statuses: 'write' },
      events: ['commit_status.created'],
    }).expect(201);

    expect(body).toMatchObject({
      appId: expect.any(Number),
      slug: `ci-bot-${stamp}`,
      botLogin: `ci-bot-${stamp}[bot]`,
      name,
      description: 'Posts statuses',
      homepageUrl: 'https://bot.example',
      setupUrl: null,
      logoUrl: null,
      webhookUrl: null,
      webhookSecretSet: false,
      permissions: { metadata: 'read', statuses: 'write' },
      events: ['commit_status.created'],
      owner: { login: ownerName, type: 'user' },
      privateKeys: [],
    });
    expect(body.installUrl).toMatch(
      new RegExp(`/apps/ci-bot-${stamp}/installations/new$`),
    );
    expect(Number.isInteger(body.appId)).toBe(true);

    const bot = await botOf(body.botLogin);
    expect(bot).toMatchObject({ kind: 'bot', name });
    const accounts = await db
      .select({ id: schema.account.id })
      .from(schema.account)
      .where(eq(schema.account.userId, bot!.id));
    expect(accounts).toEqual([]);

    const listed = await api()
      .get('/api/apps')
      .set('cookie', owner.cookie)
      .expect(200);
    expect(
      listed.body.apps.map((each: { slug: string }) => each.slug),
    ).toContain(body.slug);
    const otherList = await api()
      .get('/api/apps')
      .set('cookie', other.cookie)
      .expect(200);
    expect(
      otherList.body.apps.map((each: { slug: string }) => each.slug),
    ).not.toContain(body.slug);
  });

  it('gives every app its own App ID', async () => {
    const first = await register(owner.cookie).expect(201);
    const second = await register(owner.cookie).expect(201);
    expect(second.body.appId).not.toBe(first.body.appId);
  });

  it('refuses a name another app took, even a deleted one', async () => {
    const name = fresh();
    const { body } = await register(owner.cookie, { name }).expect(201);
    const again = await register(other.cookie, { name }).expect(422);
    expect(again.body.message).toBe('An app already uses that name');

    await api()
      .delete(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .expect(204);
    const afterDelete = await register(owner.cookie, { name }).expect(422);
    expect(afterDelete.body.message).toBe('An app already uses that name');
  });

  it('refuses a name that differs only in case or punctuation, since the slug is the same', async () => {
    const name = `Same Slug ${stamp}`;
    await register(owner.cookie, { name }).expect(201);
    await register(owner.cookie, { name: `same--slug ${stamp}!` }).expect(422);
  });

  it('refuses a name with no letters or digits', async () => {
    const { body } = await register(owner.cookie, { name: '!!!' }).expect(422);
    expect(body.message).toBe('An app name needs at least one letter or digit');
  });

  it.each(['new', 'NEW', ' New! '])(
    'refuses the reserved slug from %j',
    async (name) => {
      const { body } = await register(owner.cookie, { name }).expect(422);
      expect(body.message).toBe('That app slug is reserved');
      expect(await botOf('new[bot]')).toBeUndefined();
      expect(
        await db.select().from(schema.app).where(eq(schema.app.slug, 'new')),
      ).toEqual([]);
    },
  );

  it('keeps the slug on rename and renames the bot', async () => {
    const { body } = await register(owner.cookie).expect(201);
    const renamed = await api()
      .patch(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .send({ name: `Renamed ${stamp}` })
      .expect(200);
    expect(renamed.body).toMatchObject({
      slug: body.slug,
      botLogin: body.botLogin,
      name: `Renamed ${stamp}`,
    });
    expect((await botOf(body.botLogin))?.name).toBe(`Renamed ${stamp}`);
  });

  it('updates and clears optional fields', async () => {
    const { body } = await register(owner.cookie, {
      description: 'App description',
      setupUrl: 'https://bot.example/setup',
      webhookUrl: 'https://bot.example/hook',
    }).expect(201);
    expect(body).toMatchObject({
      setupUrl: 'https://bot.example/setup',
      webhookUrl: 'https://bot.example/hook',
    });
    const cleared = await api()
      .patch(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .send({ setupUrl: null, webhookUrl: null, description: null })
      .expect(200);
    expect(cleared.body).toMatchObject({
      setupUrl: null,
      webhookUrl: null,
      description: null,
    });
  });

  it.each(['name', 'homepageUrl', 'permissions', 'events'])(
    'ignores null %s while updating other fields',
    async (field) => {
      const { body } = await register(owner.cookie, {
        permissions: { contents: 'read' },
        events: ['push'],
      }).expect(201);
      await api()
        .patch(`/api/apps/${body.slug}`)
        .set('cookie', owner.cookie)
        .send({ [field]: null, description: 'Updated description' })
        .expect(200);
      const updated = await settings(body.slug).expect(200);
      expect(updated.body).toMatchObject({
        name: body.name,
        homepageUrl: body.homepageUrl,
        permissions: body.permissions,
        events: body.events,
        description: 'Updated description',
      });
      expect((await botOf(body.botLogin))?.name).toBe(body.name);
    },
  );

  it('accepts empty permissions and events to clear them', async () => {
    const { body } = await register(owner.cookie, {
      permissions: { contents: 'read' },
      events: ['push'],
    }).expect(201);
    const updated = await api()
      .patch(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .send({ permissions: {}, events: [] })
      .expect(200);
    expect(updated.body).toMatchObject({
      permissions: { metadata: 'read' },
      events: [],
    });
  });

  it('accepts a patch containing only null required fields', async () => {
    const { body } = await register(owner.cookie, {
      permissions: { contents: 'read' },
      events: ['push'],
    }).expect(201);
    const updated = await api()
      .patch(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .send({ name: null, homepageUrl: null, permissions: null, events: null })
      .expect(200);
    expect(updated.body).toEqual(body);
    expect((await botOf(body.botLogin))?.name).toBe(body.name);
  });

  it('refuses bad permissions, events and fields', async () => {
    await register(owner.cookie, { permissions: { members: 'write' } }).expect(
      422,
    );
    await register(owner.cookie, { permissions: { secrets: 'read' } }).expect(
      422,
    );
    const push = await register(owner.cookie, { events: ['push'] }).expect(422);
    expect(push.body.message).toBe('push needs contents:read');
    await register(owner.cookie, { events: ['nope'] }).expect(422);
    await register(owner.cookie, { name: 'x'.repeat(35) }).expect(400);
    await register(owner.cookie, { name: '' }).expect(400);
    await register(owner.cookie, { homepageUrl: 'not a url' }).expect(400);

    const { body } = await register(owner.cookie, {
      permissions: { contents: 'read' },
      events: ['push'],
    }).expect(201);
    const dropped = await api()
      .patch(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .send({ permissions: {} })
      .expect(422);
    expect(dropped.body.message).toBe('push needs contents:read');
  });

  it('generates a private key once and stores only the public half', async () => {
    const { body } = await register(owner.cookie).expect(201);
    const created = await generateKey(body.slug).expect(201);
    expect(created.body.privateKey).toMatch(
      /^-----BEGIN RSA PRIVATE KEY-----\n/,
    );
    expect(created.body.fingerprint).toMatch(/^SHA256:[A-Za-z0-9+/]+=*$/);
    expect(created.body).toMatchObject({
      id: expect.any(String),
      createdAt: expect.any(String),
    });

    const rows = await db
      .select()
      .from(schema.appPublicKey)
      .where(eq(schema.appPublicKey.id, created.body.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.publicKey).toBe(
      createPublicKey(created.body.privateKey).export({
        type: 'spki',
        format: 'pem',
      }),
    );
    expect(rows[0]!.fingerprint).toBe(created.body.fingerprint);
    const secretBody = created.body.privateKey
      .split('\n')
      .filter((line: string) => line && !line.startsWith('-----'))
      .join('');
    const stored = JSON.stringify(rows).replace(/\\n/g, '');
    expect(stored).not.toContain(secretBody.slice(0, 64));

    const read = await settings(body.slug).expect(200);
    expect(read.body.privateKeys).toEqual([
      {
        id: created.body.id,
        fingerprint: created.body.fingerprint,
        createdAt: created.body.createdAt,
      },
    ]);
    expect(JSON.stringify(read.body)).not.toContain('PRIVATE KEY');
  });

  it('deletes a key, and only from its own app', async () => {
    const first = await register(owner.cookie).expect(201);
    const second = await register(owner.cookie).expect(201);
    const kept = await generateKey(first.body.slug).expect(201);
    const removed = await generateKey(first.body.slug).expect(201);

    await api()
      .delete(`/api/apps/${second.body.slug}/private-keys/${kept.body.id}`)
      .set('cookie', owner.cookie)
      .expect(404);
    await api()
      .delete(`/api/apps/${first.body.slug}/private-keys/${removed.body.id}`)
      .set('cookie', owner.cookie)
      .expect(204);
    await api()
      .delete(`/api/apps/${first.body.slug}/private-keys/${removed.body.id}`)
      .set('cookie', owner.cookie)
      .expect(404);

    const read = await settings(first.body.slug).expect(200);
    expect(read.body.privateKeys.map((key: { id: string }) => key.id)).toEqual([
      kept.body.id,
    ]);
  });

  it('caps an app at 20 keys', async () => {
    const { body } = await register(owner.cookie).expect(201);
    for (let index = 0; index < 20; index++)
      await generateKey(body.slug).expect(201);
    const refused = await generateKey(body.slug).expect(422);
    expect(refused.body.message).toBe(
      'An app can hold at most 20 private keys',
    );
  });

  it("hides another user's app, and shows anyone its public face", async () => {
    const { body } = await register(owner.cookie, {
      permissions: { contents: 'read' },
      webhookUrl: 'https://bot.example/hook',
    }).expect(201);
    const key = await generateKey(body.slug).expect(201);

    await settings(body.slug, other.cookie).expect(404);
    await api()
      .patch(`/api/apps/${body.slug}`)
      .set('cookie', other.cookie)
      .send({ name: 'Mine now' })
      .expect(404);
    await api()
      .delete(`/api/apps/${body.slug}`)
      .set('cookie', other.cookie)
      .expect(404);
    await generateKey(body.slug, other.cookie).expect(404);
    await api()
      .delete(`/api/apps/${body.slug}/private-keys/${key.body.id}`)
      .set('cookie', other.cookie)
      .expect(404);
    await api()
      .put(`/api/apps/${body.slug}/logo`)
      .set('cookie', other.cookie)
      .set('content-type', 'image/png')
      .send(PNG)
      .expect(404);

    for (const call of [
      api().get(`/api/apps/${body.slug}`).set('cookie', other.cookie),
      api().get(`/api/apps/${body.slug}`),
    ]) {
      const seen = await call.expect(200);
      expect(seen.body).toEqual({
        appId: body.appId,
        slug: body.slug,
        name: body.name,
        description: null,
        homepageUrl: 'https://bot.example',
        logoUrl: null,
        owner: { login: ownerName, type: 'user' },
        installUrl: body.installUrl,
      });
    }
    await api().get(`/api/apps/nope-${stamp}`).expect(404);
  });

  it('stores the webhook secret sealed and never returns it', async () => {
    const secret = `shh-${stamp}`;
    const { body } = await register(owner.cookie, {
      webhookUrl: 'https://bot.example/hook',
      webhookSecret: secret,
    }).expect(201);
    expect(body.webhookSecretSet).toBe(true);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(
      JSON.stringify((await settings(body.slug).expect(200)).body),
    ).not.toContain(secret);

    const [row] = await db
      .select({ webhookSecret: schema.app.webhookSecret })
      .from(schema.app)
      .where(eq(schema.app.slug, body.slug));
    expect(row?.webhookSecret).toBeTruthy();
    expect(row?.webhookSecret).not.toContain(secret);

    const cleared = await api()
      .patch(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .send({ webhookSecret: null })
      .expect(200);
    expect(cleared.body.webhookSecretSet).toBe(false);
    const [afterClear] = await db
      .select({ webhookSecret: schema.app.webhookSecret })
      .from(schema.app)
      .where(eq(schema.app.slug, body.slug));
    expect(afterClear?.webhookSecret).toBeNull();
  });

  it('sets and removes a logo, which the bot wears too', async () => {
    const { body } = await register(owner.cookie).expect(201);
    const uploaded = await api()
      .put(`/api/apps/${body.slug}/logo`)
      .set('cookie', owner.cookie)
      .set('content-type', 'image/png')
      .send(PNG)
      .expect(200);
    expect(uploaded.body.url).toMatch(/\.png$/);
    expect(
      (await api().get(`/api/apps/${body.slug}`).expect(200)).body.logoUrl,
    ).toBe(uploaded.body.url);
    expect((await botOf(body.botLogin))?.image).toBe(uploaded.body.url);

    await api()
      .delete(`/api/apps/${body.slug}/logo`)
      .set('cookie', owner.cookie)
      .expect(204);
    expect((await settings(body.slug).expect(200)).body.logoUrl).toBeNull();
    expect((await botOf(body.botLogin))?.image).toBeNull();
  });

  it('deletes an app but keeps its bot, App ID and slug', async () => {
    const { body } = await register(owner.cookie, {
      webhookUrl: 'https://bot.example/hook',
      webhookSecret: 'shh',
    }).expect(201);
    await generateKey(body.slug).expect(201);
    const [{ id }] = await db
      .select({ id: schema.app.id })
      .from(schema.app)
      .where(eq(schema.app.slug, body.slug));

    await api()
      .delete(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .expect(204);

    await api().get(`/api/apps/${body.slug}`).expect(404);
    await settings(body.slug).expect(404);
    await api()
      .delete(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .expect(404);
    const listed = await api()
      .get('/api/apps')
      .set('cookie', owner.cookie)
      .expect(200);
    expect(
      listed.body.apps.map((each: { slug: string }) => each.slug),
    ).not.toContain(body.slug);

    const [row] = await db
      .select({
        numericId: schema.app.numericId,
        deletedAt: schema.app.deletedAt,
        webhookUrl: schema.app.webhookUrl,
        webhookSecret: schema.app.webhookSecret,
      })
      .from(schema.app)
      .where(eq(schema.app.id, id));
    expect(row).toEqual({
      numericId: body.appId,
      deletedAt: expect.any(Date),
      webhookUrl: null,
      webhookSecret: null,
    });
    expect(
      await db
        .select({ id: schema.appPublicKey.id })
        .from(schema.appPublicKey)
        .where(eq(schema.appPublicKey.appId, id)),
    ).toEqual([]);
    expect(await botOf(body.botLogin)).toMatchObject({ kind: 'bot' });
  });

  it('refuses an API key on every management route', async () => {
    const { body } = await register(owner.cookie).expect(201);
    for (const call of [
      api().get('/api/apps'),
      api()
        .post('/api/apps')
        .send({
          name: fresh(),
          homepageUrl: 'https://bot.example',
          permissions: {},
          events: [],
        }),
      api().get(`/api/apps/${body.slug}/settings`),
      api().patch(`/api/apps/${body.slug}`).send({ name: 'Key' }),
      api().delete(`/api/apps/${body.slug}`),
      api().post(`/api/apps/${body.slug}/private-keys`),
    ])
      await call.set('authorization', `Bearer ${owner.key}`).expect(403);
    await settings(body.slug).expect(200);
  });

  describe('organization apps', () => {
    const org = `aporg${stamp}`;
    let organizationId: string;
    let admin: { cookie: string; key: string; userId: string };
    let member: { cookie: string; key: string; userId: string };
    const orgPath = (slug = org) => `/api/organizations/${slug}/apps`;

    beforeAll(async () => {
      admin = await signUp(app, `apadmin${stamp}`);
      member = await signUp(app, `apmember${stamp}`);
      organizationId = (await auth().createOrganization({
        body: { name: 'Apps Org', slug: org },
        headers: new Headers({ cookie: owner.cookie }),
      }))!.id;
      await auth().addMember({
        body: { userId: admin.userId, role: 'admin', organizationId },
      });
      await auth().addMember({
        body: { userId: member.userId, role: 'member', organizationId },
      });
    });

    it('files the app under the organization, for any admin to manage', async () => {
      const { body } = await register(admin.cookie, {}, orgPath()).expect(201);
      expect(body.owner).toEqual({ login: org, type: 'organization' });
      const [row] = await db
        .select({
          ownerUserId: schema.app.ownerUserId,
          ownerOrganizationId: schema.app.ownerOrganizationId,
        })
        .from(schema.app)
        .where(eq(schema.app.slug, body.slug));
      expect(row).toEqual({
        ownerUserId: null,
        ownerOrganizationId: organizationId,
      });

      const listed = await api()
        .get(orgPath())
        .set('cookie', owner.cookie)
        .expect(200);
      expect(
        listed.body.apps.map((each: { slug: string }) => each.slug),
      ).toContain(body.slug);
      const personal = await api()
        .get('/api/apps')
        .set('cookie', admin.cookie)
        .expect(200);
      expect(
        personal.body.apps.map((each: { slug: string }) => each.slug),
      ).not.toContain(body.slug);

      await settings(body.slug, owner.cookie).expect(200);
      await api()
        .patch(`/api/apps/${body.slug}`)
        .set('cookie', owner.cookie)
        .send({ name: `Org renamed ${stamp}` })
        .expect(200);
      await generateKey(body.slug, owner.cookie).expect(201);
    });

    it('keeps members below admin and outsiders out', async () => {
      const { body } = await register(admin.cookie, {}, orgPath()).expect(201);
      await register(member.cookie, {}, orgPath()).expect(403);
      await api().get(orgPath()).set('cookie', member.cookie).expect(403);
      await settings(body.slug, member.cookie).expect(403);
      await generateKey(body.slug, member.cookie).expect(403);
      await register(other.cookie, {}, orgPath()).expect(404);
      await settings(body.slug, other.cookie).expect(404);
    });

    it('soft-deletes the apps of an organization that is deleted, and keeps their slugs taken', async () => {
      const doomed = `apdoomed${stamp}`;
      const doomedId = (await auth().createOrganization({
        body: { name: 'Doomed', slug: doomed },
        headers: new Headers({ cookie: owner.cookie }),
      }))!.id;
      const name = fresh();
      const { body } = await register(
        owner.cookie,
        { name },
        orgPath(doomed),
      ).expect(201);

      await auth().deleteOrganization({
        body: { organizationId: doomedId },
        headers: new Headers({ cookie: owner.cookie }),
      });

      const [row] = await db
        .select({ deletedAt: schema.app.deletedAt })
        .from(schema.app)
        .where(eq(schema.app.slug, body.slug));
      expect(row?.deletedAt).toEqual(expect.any(Date));
      await api().get(`/api/apps/${body.slug}`).expect(404);
      await register(owner.cookie, { name }).expect(422);
      expect(await botOf(body.botLogin)).toMatchObject({ kind: 'bot' });
    });
  });
});
