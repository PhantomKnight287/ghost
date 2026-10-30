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

// An address, not a name: an app's webhook URL must resolve to a public address.
const HOOK = 'https://93.184.216.34/hook';

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

  const endpointOf = async (slug: string) =>
    (
      await db
        .select({
          id: schema.webhookEndpoint.id,
          url: schema.webhookEndpoint.url,
          secret: schema.webhookEndpoint.secret,
          events: schema.webhookEndpoint.events,
          active: schema.webhookEndpoint.active,
          repositoryId: schema.webhookEndpoint.repositoryId,
          organizationId: schema.webhookEndpoint.organizationId,
          disabledNotifiedAt: schema.webhookEndpoint.disabledNotifiedAt,
        })
        .from(schema.webhookEndpoint)
        .innerJoin(schema.app, eq(schema.app.id, schema.webhookEndpoint.appId))
        .where(eq(schema.app.slug, slug))
    )[0];
  const jobsOf = (endpointId: string) =>
    db
      .select()
      .from(schema.deliveryJob)
      .where(eq(schema.deliveryJob.endpointId, endpointId));

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
      webhookUrl: HOOK,
      webhookSecret: 'shh',
    }).expect(201);
    expect(body).toMatchObject({
      setupUrl: 'https://bot.example/setup',
      webhookUrl: HOOK,
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
  }, 30_000);

  it("hides another user's app, and shows anyone its public face", async () => {
    const { body } = await register(owner.cookie, {
      permissions: { contents: 'read' },
      webhookUrl: HOOK,
      webhookSecret: 'shh',
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
        permissions: { metadata: 'read', contents: 'read' },
        events: [],
      });
    }
    await api().get(`/api/apps/nope-${stamp}`).expect(404);
  });

  it('stores the webhook secret sealed and never returns it', async () => {
    const secret = `shh-${stamp}`;
    const { body } = await register(owner.cookie, {
      webhookUrl: HOOK,
      webhookSecret: secret,
    }).expect(201);
    expect(body.webhookSecretSet).toBe(true);
    expect(JSON.stringify(body)).not.toContain(secret);
    expect(
      JSON.stringify((await settings(body.slug).expect(200)).body),
    ).not.toContain(secret);

    const row = await endpointOf(body.slug);
    expect(row?.secret).toBeTruthy();
    expect(row?.secret).not.toContain(secret);
  });

  it('creating an app with a webhook URL creates its endpoint, subscribed to nothing directly, and pings it', async () => {
    const { body } = await register(owner.cookie, {
      permissions: { contents: 'read' },
      events: ['push'],
      webhookUrl: HOOK,
      webhookSecret: 'shh',
    }).expect(201);
    const row = await endpointOf(body.slug);
    expect(row).toMatchObject({
      url: HOOK,
      events: [],
      active: true,
      repositoryId: null,
      organizationId: null,
    });
    expect(body).toMatchObject({
      webhookId: row!.id,
      webhookActive: true,
      webhookDisabledReason: null,
    });
    const jobs = await jobsOf(row!.id);
    expect(jobs.map((job) => (job.payload as { event: string }).event)).toEqual(
      ['ping'],
    );
    expect(
      JSON.parse((jobs[0]!.payload as { body: string }).body),
    ).toMatchObject({ event: 'ping', app: { slug: body.slug } });
  });

  it('creates no endpoint without a webhook URL', async () => {
    const { body } = await register(owner.cookie).expect(201);
    expect(await endpointOf(body.slug)).toBeUndefined();
    expect(body).toMatchObject({
      webhookUrl: null,
      webhookSecretSet: false,
      webhookId: null,
    });
  });

  it('refuses a webhook URL without a secret', async () => {
    const refused = await register(owner.cookie, { webhookUrl: HOOK }).expect(
      422,
    );
    expect(refused.body.message).toBe('A webhook URL needs a secret');

    const { body } = await register(owner.cookie, {
      webhookUrl: HOOK,
      webhookSecret: 'shh',
    }).expect(201);
    const cleared = await api()
      .patch(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .send({ webhookSecret: null })
      .expect(422);
    expect(cleared.body.message).toBe('A webhook URL needs a secret');
  });

  it('refuses a private-network webhook URL', async () => {
    const { body } = await register(owner.cookie, {
      webhookUrl: 'http://127.0.0.1/hook',
      webhookSecret: 'shh',
    }).expect(400);
    expect(body.message).toContain('private or reserved address');
  });

  it('clearing the URL deletes the endpoint, and changing it keeps the endpoint id', async () => {
    const { body } = await register(owner.cookie, {
      webhookUrl: HOOK,
      webhookSecret: 'shh',
    }).expect(201);
    const before = await endpointOf(body.slug);

    await api()
      .patch(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .send({ webhookUrl: `${HOOK}/moved` })
      .expect(200);
    const moved = await endpointOf(body.slug);
    expect(moved).toMatchObject({ id: before!.id, url: `${HOOK}/moved` });
    expect(moved!.secret).toBe(before!.secret);

    const cleared = await api()
      .patch(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .send({ webhookUrl: null })
      .expect(200);
    expect(cleared.body).toMatchObject({
      webhookUrl: null,
      webhookSecretSet: false,
      webhookId: null,
    });
    expect(await endpointOf(body.slug)).toBeUndefined();
  });

  it('webhookActive false turns the endpoint off, true turns it back on and clears the disabled reason', async () => {
    const { body } = await register(owner.cookie, {
      webhookUrl: HOOK,
      webhookSecret: 'shh',
    }).expect(201);
    const off = await api()
      .patch(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .send({ webhookActive: false })
      .expect(200);
    expect(off.body.webhookActive).toBe(false);

    await db
      .update(schema.webhookEndpoint)
      .set({
        disabledReason: 'The endpoint responded 410 Gone.',
        disabledNotifiedAt: new Date(),
      })
      .where(eq(schema.webhookEndpoint.id, off.body.webhookId));
    expect((await settings(body.slug).expect(200)).body).toMatchObject({
      webhookActive: false,
      webhookDisabledReason: 'The endpoint responded 410 Gone.',
    });

    const on = await api()
      .patch(`/api/apps/${body.slug}`)
      .set('cookie', owner.cookie)
      .send({ webhookActive: true })
      .expect(200);
    expect(on.body).toMatchObject({
      webhookActive: true,
      webhookDisabledReason: null,
    });
    expect((await endpointOf(body.slug))?.disabledNotifiedAt).toBeNull();
  });

  it('lists deliveries and redelivers for the owner, 404 for anyone else', async () => {
    const { body } = await register(owner.cookie, {
      webhookUrl: HOOK,
      webhookSecret: 'shh',
    }).expect(201);
    const deliveries = (cookie: string) =>
      api()
        .get(`/api/apps/${body.slug}/webhook/deliveries`)
        .set('cookie', cookie);

    const listed = await deliveries(owner.cookie).expect(200);
    expect(
      listed.body.deliveries.map((d: { event: string }) => d.event),
    ).toEqual(['ping']);
    const [ping] = listed.body.deliveries;

    await api()
      .post(`/api/apps/${body.slug}/webhook/deliveries/${ping.id}/redeliveries`)
      .set('cookie', owner.cookie)
      .expect(204);
    await api()
      .post(`/api/apps/${body.slug}/webhook/pings`)
      .set('cookie', owner.cookie)
      .expect(204);
    expect(
      (await deliveries(owner.cookie).expect(200)).body.deliveries,
    ).toHaveLength(3);

    await deliveries(other.cookie).expect(404);
    await api()
      .post(`/api/apps/${body.slug}/webhook/deliveries/${ping.id}/redeliveries`)
      .set('cookie', other.cookie)
      .expect(404);
    await api()
      .post(`/api/apps/${body.slug}/webhook/pings`)
      .set('cookie', other.cookie)
      .expect(404);

    const bare = await register(owner.cookie).expect(201);
    await api()
      .get(`/api/apps/${bare.body.slug}/webhook/deliveries`)
      .set('cookie', owner.cookie)
      .expect(404);
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
      webhookUrl: HOOK,
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
      })
      .from(schema.app)
      .where(eq(schema.app.id, id));
    expect(row).toEqual({
      numericId: body.appId,
      deletedAt: expect.any(Date),
    });
    expect(
      await db
        .select({ id: schema.webhookEndpoint.id })
        .from(schema.webhookEndpoint)
        .where(eq(schema.webhookEndpoint.appId, id)),
    ).toEqual([]);
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
      api().post('/api/apps').send({
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

  describe('user authorization settings', () => {
    const clientRow = async (clientId: string) =>
      (
        await db
          .select({
            name: schema.oauthClient.name,
            redirectUris: schema.oauthClient.redirectUris,
            metadata: schema.oauthClient.metadata,
          })
          .from(schema.oauthClient)
          .where(eq(schema.oauthClient.clientId, clientId))
      )[0];
    const newSecret = (slug: string, cookie = owner.cookie) =>
      api().post(`/api/apps/${slug}/client-secrets`).set('cookie', cookie);

    it('gives a new app a client id, expiring tokens on and device flow off', async () => {
      const { body } = await register(owner.cookie).expect(201);
      expect(body).toMatchObject({
        clientId: expect.any(String),
        expireUserTokens: true,
        deviceFlowEnabled: false,
        requestOauthOnInstall: false,
        callbackUrls: [],
        clientSecrets: [],
      });
      const [row] = await db
        .select({ id: schema.app.id })
        .from(schema.app)
        .where(eq(schema.app.slug, body.slug));
      expect((await clientRow(body.clientId))?.metadata).toMatchObject({
        appId: row!.id,
      });
    });

    it('creates a client secret once, then shows only its last eight characters', async () => {
      const { body } = await register(owner.cookie).expect(201);
      const created = await newSecret(body.slug).expect(201);
      expect(created.body).toMatchObject({
        id: expect.any(String),
        clientSecret: expect.stringMatching(/^ghost_cs_[0-9a-f]{40}$/),
        lastEight: created.body.clientSecret.slice(-8),
      });
      const seen = (await settings(body.slug).expect(200)).body;
      expect(seen.clientSecrets).toEqual([
        {
          id: created.body.id,
          lastEight: created.body.clientSecret.slice(-8),
          createdAt: expect.any(String),
        },
      ]);
      expect(JSON.stringify(seen)).not.toContain(created.body.clientSecret);

      await api()
        .delete(`/api/apps/${body.slug}/client-secrets/${created.body.id}`)
        .set('cookie', owner.cookie)
        .expect(204);
      expect((await settings(body.slug).expect(200)).body.clientSecrets).toEqual(
        [],
      );
    });

    it('caps client secrets at 20', async () => {
      const { body } = await register(owner.cookie).expect(201);
      for (let i = 0; i < 20; i++) await newSecret(body.slug).expect(201);
      const refused = await newSecret(body.slug).expect(422);
      expect(refused.body.message).toBe(
        'An app can have at most 20 client secrets',
      );
    }, 30_000);

    it('caps callback URLs at 10', async () => {
      await register(owner.cookie, {
        callbackUrls: Array.from(
          { length: 11 },
          (_, i) => `https://bot.example/callback/${i}`,
        ),
      }).expect(400);
    });

    it('refuses requestOauthOnInstall without a callback URL', async () => {
      const refused = await register(owner.cookie, {
        requestOauthOnInstall: true,
      }).expect(422);
      expect(refused.body.message).toBe(
        'Add a callback URL before asking for user authorization during installation',
      );
    });

    it('keeps the client in step', async () => {
      const { body } = await register(owner.cookie).expect(201);
      await api()
        .patch(`/api/apps/${body.slug}`)
        .set('cookie', owner.cookie)
        .send({
          name: `Renamed ${stamp} ${apps++}`,
          callbackUrls: ['https://bot.example/callback'],
          deviceFlowEnabled: true,
          expireUserTokens: false,
          requestOauthOnInstall: true,
        })
        .expect(200);
      const row = await clientRow(body.clientId);
      expect(row).toMatchObject({
        name: expect.stringMatching(/^Renamed /),
        redirectUris: ['https://bot.example/callback'],
        metadata: expect.objectContaining({
          deviceFlow: true,
          expireUserTokens: false,
        }),
      });
      expect((await settings(body.slug).expect(200)).body).toMatchObject({
        callbackUrls: ['https://bot.example/callback'],
        deviceFlowEnabled: true,
        expireUserTokens: false,
        requestOauthOnInstall: true,
      });
    });

    it('deleting an app deletes its client, secrets and user tokens', async () => {
      const { body } = await register(owner.cookie).expect(201);
      await newSecret(body.slug).expect(201);
      const [row] = await db
        .select({ id: schema.app.id })
        .from(schema.app)
        .where(eq(schema.app.slug, body.slug));
      await db.insert(schema.appUserToken).values({
        appId: row!.id,
        userId: owner.userId,
        tokenHash: randomBytes(32).toString('hex'),
      });

      await api()
        .delete(`/api/apps/${body.slug}`)
        .set('cookie', owner.cookie)
        .expect(204);

      expect(await clientRow(body.clientId)).toBeUndefined();
      expect(
        await db
          .select({ id: schema.appClientSecret.id })
          .from(schema.appClientSecret)
          .where(eq(schema.appClientSecret.appId, row!.id)),
      ).toEqual([]);
      expect(
        await db
          .select({ id: schema.appUserToken.id })
          .from(schema.appUserToken)
          .where(eq(schema.appUserToken.appId, row!.id)),
      ).toEqual([]);
    });

    it('hides client secrets from anyone but the owner', async () => {
      const { body } = await register(owner.cookie).expect(201);
      const created = await newSecret(body.slug).expect(201);
      await newSecret(body.slug, other.cookie).expect(404);
      await api()
        .delete(`/api/apps/${body.slug}/client-secrets/${created.body.id}`)
        .set('cookie', other.cookie)
        .expect(404);
    });
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
