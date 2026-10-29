import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { type Database, schema } from '@ghost/db';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DATABASE } from '../src/database/database.module.js';
import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>>;

/** Ghost's own API for rulesets, which the settings page uses. Enforcement is in rulesets-enforcement.e2e-spec.ts, the GitHub REST shapes in github-rulesets.e2e-spec.ts. */
describe.skipIf(!hasBackends)('rulesets API', () => {
  let app: INestApplication;
  let origin: string;
  let owner: Account;
  let admin: Account;
  let writer: Account;
  let reader: Account;
  let work: string;
  let repositoryId: string;
  let teamId: string;
  let foreignTeamId: string;
  const stamp = Date.now();
  const ownerName = `rsowner${stamp}`;
  const adminName = `rsadmin${stamp}`;
  const writerName = `rswriter${stamp}`;
  const readerName = `rsreader${stamp}`;
  const org = `rsorg${stamp}`;
  const otherOrg = `rsother${stamp}`;
  const repo = `${org}/guarded`;

  const api = () => request(app.getHttpServer());
  const db = () => app.get<Database>(DATABASE);
  const auth = () => app.get<AuthService<Auth>>(AuthService).api;
  const at = (suffix = '') => `/api/repositories/${repo}/rulesets${suffix}`;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const push = (...refs: string[]) =>
    promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        `${origin.replace('://', `://${ownerName}:${owner.key}@`)}/${repo}.git`,
        ...refs,
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const collaborate = async (
    account: Account,
    username: string,
    role: string,
  ) => {
    await api()
      .put(`/api/repositories/${repo}/collaborators/${username}`)
      .set('cookie', owner.cookie)
      .send({ role })
      .expect(200);
    const invitation = (
      await api()
        .get('/api/invitations')
        .set('cookie', account.cookie)
        .expect(200)
    ).body.invitations[0];
    await api()
      .post(`/api/invitations/${invitation.id}/accept`)
      .set('cookie', account.cookie)
      .expect(204);
  };
  const valid = (overrides: object = {}) => ({
    name: `rules ${Math.random().toString(36).slice(2)}`,
    target: 'branch',
    enforcement: 'active',
    include: ['main'],
    exclude: [],
    bypassActors: [],
    rules: [{ type: 'deletion' }],
    ...overrides,
  });
  const createAs = (account: Account, body: object) =>
    api().post(at()).set('cookie', account.cookie).send(body);
  const create = async (overrides: object = {}) =>
    (await createAs(owner, valid(overrides)).expect(201)).body;
  const outbox = (type: string) =>
    db()
      .select({ payload: schema.outboxEvent.payload })
      .from(schema.outboxEvent)
      .where(
        and(
          eq(schema.outboxEvent.repositoryId, repositoryId),
          eq(schema.outboxEvent.type, type),
        ),
      );

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await signUp(app, ownerName);
    admin = await signUp(app, adminName);
    writer = await signUp(app, writerName);
    reader = await signUp(app, readerName);
    const { id: organizationId } = (await auth().createOrganization({
      body: { name: 'Rulesets', slug: org },
      headers: new Headers({ cookie: owner.cookie }),
    }))!;
    const { id: otherOrganizationId } = (await auth().createOrganization({
      body: { name: 'Elsewhere', slug: otherOrg },
      headers: new Headers({ cookie: owner.cookie }),
    }))!;
    repositoryId = (
      await api()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name: 'guarded', organization: org, visibility: 'public' })
        .expect(201)
    ).body.id;
    await collaborate(admin, adminName, 'admin');
    await collaborate(writer, writerName, 'write');
    await collaborate(reader, readerName, 'read');
    teamId = (await auth().createTeam({
      body: { name: 'Core', organizationId },
      headers: new Headers({ cookie: owner.cookie }),
    }))!.id;
    foreignTeamId = (await auth().createTeam({
      body: { name: 'Outsiders', organizationId: otherOrganizationId },
      headers: new Headers({ cookie: owner.cookie }),
    }))!.id;

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-rulesets-'));
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'a\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    for (const name of [
      'dev',
      'release/1.0',
      'release/2.0',
      'release/3.0/hotfix',
      'feature/x',
    ]) {
      git('branch', name);
    }
    git('tag', 'v1.0');
    git('tag', 'v2.0');
    git('tag', 'nightly');
    await push('--all');
    await push('--tags');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  describe('managing', () => {
    it('lets an admin create a ruleset, and returns it with patterns in full ref form', async () => {
      const { body } = await createAs(
        admin,
        valid({
          name: 'protect main',
          include: ['main', 'refs/heads/dev', '~DEFAULT_BRANCH'],
          exclude: ['release/*'],
          bypassActors: [
            {
              actorType: 'RepositoryRole',
              role: 'maintain',
              bypassMode: 'always',
            },
            { actorType: 'Team', teamId, bypassMode: 'pull_request' },
            { actorType: 'OrganizationAdmin', bypassMode: 'always' },
          ],
          rules: [{ type: 'deletion' }, { type: 'non_fast_forward' }],
        }),
      ).expect(201);

      expect(body).toEqual({
        id: expect.any(String),
        name: 'protect main',
        target: 'branch',
        enforcement: 'active',
        include: ['refs/heads/main', 'refs/heads/dev', '~DEFAULT_BRANCH'],
        exclude: ['refs/heads/release/*'],
        bypassActors: expect.arrayContaining([
          {
            actorType: 'RepositoryRole',
            role: 'maintain',
            bypassMode: 'always',
          },
          { actorType: 'Team', teamId, bypassMode: 'pull_request' },
          { actorType: 'OrganizationAdmin', bypassMode: 'always' },
        ]),
        rules: expect.arrayContaining([
          { type: 'deletion' },
          { type: 'non_fast_forward' },
        ]),
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      });
      expect(body.bypassActors).toHaveLength(3);
      expect(body.rules).toHaveLength(2);

      const fetched = (
        await api()
          .get(at(`/${body.id}`))
          .set('cookie', admin.cookie)
          .expect(200)
      ).body;
      expect(fetched).toEqual(body);
    });

    it('lets the owner create a tag ruleset', async () => {
      const body = await create({ target: 'tag', include: ['v*'] });
      expect(body).toMatchObject({ target: 'tag', include: ['refs/tags/v*'] });
    });

    it('lists the repository rulesets', async () => {
      const made = await create({ name: 'listed' });
      const { body } = await api()
        .get(at())
        .set('cookie', owner.cookie)
        .expect(200);

      expect(body.rulesets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: made.id, name: 'listed' }),
        ]),
      );
    });

    it('replaces a ruleset on update, and stamps the update', async () => {
      const made = await create({ name: 'to edit' });
      const { body } = await api()
        .put(at(`/${made.id}`))
        .set('cookie', owner.cookie)
        .send(
          valid({
            name: 'edited',
            enforcement: 'disabled',
            include: ['~ALL'],
            exclude: ['dev'],
            rules: [{ type: 'update' }],
          }),
        )
        .expect(200);

      expect(body).toMatchObject({
        id: made.id,
        name: 'edited',
        enforcement: 'disabled',
        include: ['~ALL'],
        exclude: ['refs/heads/dev'],
        rules: [{ type: 'update' }],
        bypassActors: [],
      });
      expect(new Date(body.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(made.updatedAt).getTime(),
      );
    });

    it('deletes a ruleset', async () => {
      const made = await create();
      await api()
        .delete(at(`/${made.id}`))
        .set('cookie', owner.cookie)
        .expect(204);
      await api()
        .get(at(`/${made.id}`))
        .set('cookie', owner.cookie)
        .expect(404);
      await api()
        .delete(at(`/${made.id}`))
        .set('cookie', owner.cookie)
        .expect(404);
    });

    it('records every change in the outbox', async () => {
      const made = await create({ name: 'audited' });
      await api()
        .put(at(`/${made.id}`))
        .set('cookie', owner.cookie)
        .send(valid({ name: 'audited again' }))
        .expect(200);
      await api()
        .delete(at(`/${made.id}`))
        .set('cookie', owner.cookie)
        .expect(204);

      for (const type of [
        'repository_ruleset.created',
        'repository_ruleset.edited',
        'repository_ruleset.deleted',
      ]) {
        const events = await outbox(type);
        expect(
          events.filter(
            ({ payload }) =>
              (payload as { rulesetId?: string }).rulesetId === made.id,
          ),
        ).toHaveLength(1);
      }
    });
  });

  describe('who may', () => {
    it('refuses writers and readers anything but reading', async () => {
      const made = await create();
      for (const account of [writer, reader]) {
        await createAs(account, valid()).expect(403);
        await api()
          .put(at(`/${made.id}`))
          .set('cookie', account.cookie)
          .send(valid())
          .expect(403);
        await api()
          .delete(at(`/${made.id}`))
          .set('cookie', account.cookie)
          .expect(403);
      }
      await api()
        .get(at(`/${made.id}`))
        .set('cookie', owner.cookie)
        .expect(200);
    });

    it('lets readers read rulesets, but hides who can bypass them', async () => {
      const made = await create({
        bypassActors: [
          { actorType: 'OrganizationAdmin', bypassMode: 'always' },
        ],
      });
      const { body } = await api()
        .get(at(`/${made.id}`))
        .set('cookie', reader.cookie)
        .expect(200);
      expect(body).toMatchObject({ id: made.id, rules: made.rules });
      expect(body).not.toHaveProperty('bypassActors');

      const list = (
        await api().get(at()).set('cookie', reader.cookie).expect(200)
      ).body;
      for (const ruleset of list.rulesets) {
        expect(ruleset).not.toHaveProperty('bypassActors');
      }
    });

    it('requires signing in to change anything', async () => {
      await api().post(at()).send(valid()).expect(401);
    });
  });

  describe('validation', () => {
    it('refuses malformed rulesets', async () => {
      const malformed = [
        { name: '' },
        { target: 'push' },
        { enforcement: 'sometimes' },
        { include: 'main' },
        { rules: [{ type: 'teleport' }] },
        { rules: [{ type: 'deletion' }, { type: 'deletion' }] },
        { bypassActors: [{ actorType: 'Integration', bypassMode: 'always' }] },
        {
          bypassActors: [
            { actorType: 'RepositoryRole', role: 'read', bypassMode: 'always' },
          ],
        },
        {
          bypassActors: [
            {
              actorType: 'RepositoryRole',
              role: 'write',
              bypassMode: 'sometimes',
            },
          ],
        },
      ];
      for (const overrides of malformed) {
        const { status } = await createAs(owner, valid(overrides));
        expect({ overrides, status }).toEqual({ overrides, status: 400 });
      }
    });

    it('refuses a team that is not on the owning organization', async () => {
      await createAs(
        owner,
        valid({
          bypassActors: [
            { actorType: 'Team', teamId: foreignTeamId, bypassMode: 'always' },
          ],
        }),
      ).expect(422);
      await createAs(
        owner,
        valid({
          bypassActors: [
            { actorType: 'Team', teamId: 'team_missing', bypassMode: 'always' },
          ],
        }),
      ).expect(422);
    });

    it('refuses a name already taken, on create and on rename', async () => {
      const first = await create({ name: 'unique name' });
      await createAs(owner, valid({ name: 'unique name' })).expect(409);
      const second = await create({ name: 'another name' });
      await api()
        .put(at(`/${second.id}`))
        .set('cookie', owner.cookie)
        .send(valid({ name: 'unique name' }))
        .expect(409);
      // Keeping its own name is not a clash.
      await api()
        .put(at(`/${first.id}`))
        .set('cookie', owner.cookie)
        .send(valid({ name: 'unique name' }))
        .expect(200);
    });

    it('scopes rulesets to their repository', async () => {
      const made = await create();
      const elsewhere = (
        await api()
          .post('/api/repositories')
          .set('cookie', owner.cookie)
          .send({ name: 'other', organization: org, visibility: 'public' })
          .expect(201)
      ).body.slug;
      await api()
        .get(`/api/repositories/${org}/${elsewhere}/rulesets/${made.id}`)
        .set('cookie', owner.cookie)
        .expect(404);
    });
  });

  describe('personal repositories', () => {
    it('refuses team and organization admin bypass actors where there is no organization', async () => {
      const personal = (
        await api()
          .post('/api/repositories')
          .set('cookie', owner.cookie)
          .send({ name: 'mine', visibility: 'public' })
          .expect(201)
      ).body.slug;
      const personalAt = `/api/repositories/${ownerName}/${personal}/rulesets`;

      await api()
        .post(personalAt)
        .set('cookie', owner.cookie)
        .send(
          valid({
            bypassActors: [
              { actorType: 'OrganizationAdmin', bypassMode: 'always' },
            ],
          }),
        )
        .expect(422);
      await api()
        .post(personalAt)
        .set('cookie', owner.cookie)
        .send(
          valid({
            bypassActors: [{ actorType: 'Team', teamId, bypassMode: 'always' }],
          }),
        )
        .expect(422);
      await api()
        .post(personalAt)
        .set('cookie', owner.cookie)
        .send(
          valid({
            bypassActors: [
              {
                actorType: 'RepositoryRole',
                role: 'admin',
                bypassMode: 'always',
              },
            ],
          }),
        )
        .expect(201);
    });
  });

  describe('pattern preview', () => {
    const preview = (body: object) =>
      api().post(at('/preview')).set('cookie', owner.cookie).send(body);

    it('lists the existing branches the patterns target, with the enforcement matcher', async () => {
      const { body } = await preview({
        target: 'branch',
        include: ['release/*', 'main'],
        exclude: ['release/2.0'],
      }).expect(200);
      expect(body.refs).toEqual(['refs/heads/main', 'refs/heads/release/1.0']);

      const deep = await preview({
        target: 'branch',
        include: ['release/**/*'],
        exclude: [],
      }).expect(200);
      expect(deep.body.refs).toEqual([
        'refs/heads/release/1.0',
        'refs/heads/release/2.0',
        'refs/heads/release/3.0/hotfix',
      ]);

      const all = await preview({
        target: 'branch',
        include: ['~ALL'],
        exclude: ['~DEFAULT_BRANCH'],
      }).expect(200);
      expect(all.body.refs).not.toContain('refs/heads/main');
      expect(all.body.refs).toContain('refs/heads/feature/x');
    });

    it('lists tags for a tag target', async () => {
      const { body } = await preview({
        target: 'tag',
        include: ['v*'],
        exclude: [],
      }).expect(200);
      expect(body.refs).toEqual(['refs/tags/v1.0', 'refs/tags/v2.0']);
    });

    it('is for admins only', async () => {
      await api()
        .post(at('/preview'))
        .set('cookie', writer.cookie)
        .send({ target: 'branch', include: ['~ALL'], exclude: [] })
        .expect(403);
    });
  });

  describe('protected refs', () => {
    const protectedRefs = (account: Account, target: string) =>
      api()
        .get(`/api/repositories/${repo}/protected-refs`)
        .query({ target })
        .set('cookie', account.cookie);

    it('maps each targeted ref to its active rules and whether the viewer can bypass them', async () => {
      await create({
        name: 'feature lock',
        include: ['feature/*'],
        rules: [{ type: 'deletion' }, { type: 'update' }],
        bypassActors: [
          {
            actorType: 'RepositoryRole',
            role: 'write',
            bypassMode: 'pull_request',
          },
        ],
      });
      await create({
        name: 'feature lock off',
        include: ['feature/*'],
        enforcement: 'disabled',
        rules: [{ type: 'creation' }],
      });

      const asWriter = (await protectedRefs(writer, 'branch').expect(200)).body
        .refs;
      expect(asWriter['refs/heads/feature/x']).toEqual({
        rules: expect.arrayContaining(['deletion', 'update']),
        bypass: 'pull_requests_only',
      });
      expect(asWriter['refs/heads/feature/x'].rules).toHaveLength(2);
      expect(asWriter).not.toHaveProperty(['refs/heads/release/3.0/hotfix']);

      const asReader = (await protectedRefs(reader, 'branch').expect(200)).body
        .refs;
      expect(asReader['refs/heads/feature/x'].bypass).toBe('never');
    });

    it('leaves out refs whose rulesets have no rules', async () => {
      await create({
        name: 'no rules',
        include: ['release/3.0/hotfix'],
        rules: [],
      });
      const { body } = await protectedRefs(reader, 'branch').expect(200);
      expect(body.refs).not.toHaveProperty(['refs/heads/release/3.0/hotfix']);
    });

    it('covers tags with the tag target', async () => {
      await create({
        name: 'tag lock',
        target: 'tag',
        include: ['nightly'],
        rules: [{ type: 'update' }],
      });
      const { body } = await protectedRefs(reader, 'tag').expect(200);
      expect(body.refs['refs/tags/nightly']).toEqual({
        rules: ['update'],
        bypass: 'never',
      });
      expect(body.refs).not.toHaveProperty(['refs/heads/feature/x']);
    });
  });

  describe('the pull_request rule', () => {
    const parameters = {
      required_approving_review_count: 2,
      dismiss_stale_reviews_on_push: true,
      require_code_owner_review: true,
      require_last_push_approval: false,
      required_review_thread_resolution: true,
      allowed_merge_methods: ['squash', 'rebase'],
    };

    it('creates a ruleset with its parameters and returns them as given', async () => {
      const made = await create({
        rules: [{ type: 'deletion' }, { type: 'pull_request', parameters }],
      });
      expect(made.rules).toEqual(
        expect.arrayContaining([
          { type: 'deletion' },
          { type: 'pull_request', parameters },
        ]),
      );

      const fetched = (
        await api()
          .get(at(`/${made.id}`))
          .set('cookie', owner.cookie)
          .expect(200)
      ).body;
      expect(fetched.rules).toEqual(made.rules);
    });

    it('fills in the parameters left out', async () => {
      const made = await create({
        rules: [
          {
            type: 'pull_request',
            parameters: { required_approving_review_count: 1 },
          },
        ],
      });
      expect(made.rules).toEqual([
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 1,
            dismiss_stale_reviews_on_push: false,
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: false,
            allowed_merge_methods: ['merge', 'squash', 'rebase'],
          },
        },
      ]);
    });

    it('replaces the parameters on update', async () => {
      const made = await create({
        rules: [{ type: 'pull_request', parameters }],
      });
      const changed = {
        ...parameters,
        required_approving_review_count: 0,
        allowed_merge_methods: ['merge'],
      };
      const { body } = await api()
        .put(at(`/${made.id}`))
        .set('cookie', owner.cookie)
        .send(valid({ rules: [{ type: 'pull_request', parameters: changed }] }))
        .expect(200);
      expect(body.rules).toEqual([
        { type: 'pull_request', parameters: changed },
      ]);
    });

    it('refuses malformed parameters with 400', async () => {
      const malformed = [
        { ...parameters, required_approving_review_count: 11 },
        { ...parameters, required_approving_review_count: -1 },
        { ...parameters, required_approving_review_count: 1.5 },
        { ...parameters, allowed_merge_methods: [] },
        { ...parameters, allowed_merge_methods: ['ff'] },
        { ...parameters, allowed_merge_methods: ['merge', 'merge'] },
        { ...parameters, dismiss_stale_reviews_on_push: 'yes' },
        { ...parameters, teleport: true },
      ];
      for (const bad of malformed) {
        const { status } = await createAs(
          owner,
          valid({ rules: [{ type: 'pull_request', parameters: bad }] }),
        );
        expect({ bad, status }).toEqual({ bad, status: 400 });
      }
    });

    it('lists pull_request among the protected ref rules', async () => {
      await create({
        name: 'dev reviews',
        include: ['dev'],
        rules: [{ type: 'pull_request', parameters }],
      });
      const { body } = await api()
        .get(`/api/repositories/${repo}/protected-refs`)
        .query({ target: 'branch' })
        .set('cookie', reader.cookie)
        .expect(200);
      expect(body.refs['refs/heads/dev'].rules).toContain('pull_request');
    });
  });

  describe('required status checks and signatures', () => {
    it('creates a status check rule with its defaults filled in', async () => {
      const made = await create({
        rules: [
          {
            type: 'required_status_checks',
            parameters: { required_status_checks: [{ context: 'build' }] },
          },
        ],
      });
      expect(made.rules).toEqual([
        {
          type: 'required_status_checks',
          parameters: {
            required_status_checks: [{ context: 'build' }],
            strict_required_status_checks_policy: false,
            do_not_enforce_on_create: false,
          },
        },
      ]);
    });

    it('refuses an integration_id that names no app', async () => {
      const refused = await createAs(
        owner,
        valid({
          rules: [
            {
              type: 'required_status_checks',
              parameters: {
                required_status_checks: [
                  { context: 'build', integration_id: 999999999 },
                ],
              },
            },
          ],
        }),
      ).expect(400);
      expect(refused.body.message).toContain(
        'integration_id 999999999 does not name an app',
      );
    });

    it('refuses required signatures while the server has no signing key', async () => {
      const refused = await createAs(
        owner,
        valid({ rules: [{ type: 'required_signatures' }] }),
      ).expect(400);
      expect(refused.body.message).toBe(
        'Required signatures need a commit signing key on this server',
      );
    });

    it('suggests the contexts this repository has seen, newest first', async () => {
      const sha = git('rev-parse', 'HEAD');
      for (const context of ['lint', 'build', 'lint'])
        await api()
          .post(`/api/repositories/${repo}/statuses/${sha}`)
          .set('cookie', owner.cookie)
          .send({ state: 'success', context })
          .expect(201);
      const { body } = await api()
        .get(`/api/repositories/${repo}/status-contexts`)
        .set('cookie', owner.cookie)
        .expect(200);
      expect(body.contexts.slice(0, 2)).toEqual(['lint', 'build']);
    });

    it('keeps context suggestions from readers', async () => {
      await api()
        .get(`/api/repositories/${repo}/status-contexts`)
        .set('cookie', reader.cookie)
        .expect(403);
    });
  });
});
