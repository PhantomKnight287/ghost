import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Auth } from '../src/lib/auth.js';
import { hasBackends, scopedKey, signUp, startApp } from './harness.js';

type Account = { cookie: string; key: string; userId: string };

describe.skipIf(!hasBackends)(
  'GitHub REST v3 repository lists, updates and deletes',
  () => {
    let app: INestApplication;
    let owner: Account;
    let collaborator: Account;
    const username = `ghrepos${Date.now()}`;
    const collaboratorName = `${username}c`;
    const org = `${username}o`;
    const api = () => request(app.getHttpServer());
    const get = (path: string, token?: string) => {
      const call = api().get(`/api/v3${path}`);
      return token ? call.set('authorization', `token ${token}`) : call;
    };
    const send = (
      method: 'patch' | 'delete',
      path: string,
      body: object,
      token?: string,
    ) => {
      const call = api()[method](`/api/v3${path}`).send(body);
      return token ? call.set('authorization', `token ${token}`) : call;
    };
    const names = (body: { full_name: string }[]) =>
      body.map((repository) => repository.full_name);
    const create = (
      account: Account,
      name: string,
      visibility: 'public' | 'private',
      organization?: string,
    ) =>
      api()
        .post('/api/repositories')
        .set('cookie', account.cookie)
        .send({ name, visibility, organization })
        .expect(201);
    const share = async (repo: string) => {
      await api()
        .put(
          `/api/repositories/${username}/${repo}/collaborators/${collaboratorName}`,
        )
        .set('cookie', owner.cookie)
        .send({ role: 'write' })
        .expect((response) => expect(response.status).toBeLessThan(300));
      const { body } = await api()
        .get('/api/invitations')
        .set('cookie', collaborator.cookie)
        .expect(200);
      for (const invitation of body.invitations)
        await api()
          .post(`/api/invitations/${invitation.id}/accept`)
          .set('cookie', collaborator.cookie)
          .expect((response) => expect(response.status).toBeLessThan(300));
    };

    beforeAll(async () => {
      ({ app } = await startApp());
      owner = await signUp(app, username);
      collaborator = await signUp(app, collaboratorName);
      await create(owner, 'alpha', 'public');
      await create(owner, 'beta', 'private');
      await create(collaborator, 'own', 'public');
      await app.get<AuthService<Auth>>(AuthService).api.createOrganization({
        body: { name: 'Repo Org', slug: org },
        headers: new Headers({ cookie: owner.cookie }),
      });
      await create(owner, 'gamma', 'public', org);
      await create(owner, 'delta', 'private', org);
      await share('alpha');
      await share('beta');
    });

    afterAll(async () => {
      await app?.close();
    });

    describe('GET /user/repos', () => {
      it('lists everything the viewer can reach, private ones included, by full name', async () => {
        const { body } = await get('/user/repos', owner.key).expect(200);
        expect(names(body)).toEqual([
          `${username}/alpha`,
          `${username}/beta`,
          `${org}/delta`,
          `${org}/gamma`,
        ]);
        expect(body[1]).toMatchObject({
          name: 'beta',
          private: true,
          visibility: 'private',
        });
        expect(body[1].permissions).toMatchObject({ admin: true, push: true });
      });

      it('filters by visibility and affiliation', async () => {
        const at = (query: string) =>
          get(`/user/repos?${query}`, owner.key).expect(200);
        expect(names((await at('visibility=public')).body)).toEqual([
          `${username}/alpha`,
          `${org}/gamma`,
        ]);
        expect(names((await at('affiliation=owner')).body)).toEqual([
          `${username}/alpha`,
          `${username}/beta`,
        ]);
        expect(
          names((await at('affiliation=organization_member')).body),
        ).toEqual([`${org}/delta`, `${org}/gamma`]);
        expect(
          names(
            (
              await at(
                'affiliation=owner,organization_member&visibility=private',
              )
            ).body,
          ),
        ).toEqual([`${username}/beta`, `${org}/delta`]);

        const shared = await get(
          '/user/repos?affiliation=collaborator',
          collaborator.key,
        ).expect(200);
        expect(names(shared.body)).toEqual([
          `${username}/alpha`,
          `${username}/beta`,
        ]);
        const mine = await get('/user/repos', collaborator.key).expect(200);
        expect(names(mine.body)).toEqual([
          `${username}/alpha`,
          `${username}/beta`,
          `${collaboratorName}/own`,
        ]);
      });

      it('filters by type, and refuses type alongside visibility or affiliation', async () => {
        const at = (query: string) =>
          get(`/user/repos?${query}`, owner.key).expect(200);
        expect(names((await at('type=owner')).body)).toEqual([
          `${username}/alpha`,
          `${username}/beta`,
        ]);
        expect(names((await at('type=private')).body)).toEqual([
          `${username}/beta`,
          `${org}/delta`,
        ]);
        expect(names((await at('type=member')).body)).toEqual([
          `${org}/delta`,
          `${org}/gamma`,
        ]);
        await get('/user/repos?type=owner&visibility=public', owner.key).expect(
          422,
        );
        await get('/user/repos?type=owner&affiliation=owner', owner.key).expect(
          422,
        );
        await get('/user/repos?visibility=secret', owner.key).expect(422);
        await get('/user/repos?affiliation=friend', owner.key).expect(422);
      });

      it('sorts, orders and pages as GitHub does', async () => {
        const created = await get('/user/repos?sort=created', owner.key).expect(
          200,
        );
        expect(names(created.body)).toEqual([
          `${org}/delta`,
          `${org}/gamma`,
          `${username}/beta`,
          `${username}/alpha`,
        ]);
        const ascending = await get(
          '/user/repos?sort=created&direction=asc',
          owner.key,
        ).expect(200);
        expect(names(ascending.body)).toEqual(
          [...names(created.body)].reverse(),
        );
        const descending = await get(
          '/user/repos?direction=desc',
          owner.key,
        ).expect(200);
        expect(names(descending.body)[0]).toBe(`${org}/gamma`);

        const first = await get('/user/repos?per_page=3', owner.key).expect(
          200,
        );
        expect(first.body).toHaveLength(3);
        expect(first.headers.link).toMatch(/[?&]page=2[^>]*>; rel="next"/);
        const second = await get(
          '/user/repos?per_page=3&page=2',
          owner.key,
        ).expect(200);
        expect(names(second.body)).toEqual([`${org}/gamma`]);
      });

      it('hides private repositories from a token without repo, and refuses anonymous callers', async () => {
        const publicOnly = await scopedKey(app, owner.userId, ['public_repo']);
        const { body } = await get('/user/repos', publicOnly).expect(200);
        expect(names(body)).toEqual([`${username}/alpha`, `${org}/gamma`]);
        const anonymous = await get('/user/repos').expect(401);
        expect(anonymous.body.message).toBe('Requires authentication');
      });
    });

    describe('GET /users/:username/repos', () => {
      it("lists the account's public repositories, whoever asks", async () => {
        const anonymous = await get(`/users/${username}/repos`).expect(200);
        expect(names(anonymous.body)).toEqual([`${username}/alpha`]);
        const self = await get(`/users/${username}/repos`, owner.key).expect(
          200,
        );
        expect(names(self.body)).toEqual([`${username}/alpha`]);
        const organization = await get(`/users/${org}/repos`).expect(200);
        expect(names(organization.body)).toEqual([`${org}/gamma`]);
      });

      it('lists the ones the user collaborates on with type member or all', async () => {
        const at = (query: string) =>
          get(`/users/${collaboratorName}/repos${query}`).expect(200);
        expect(names((await at('')).body)).toEqual([`${collaboratorName}/own`]);
        expect(names((await at('?type=member')).body)).toEqual([
          `${username}/alpha`,
        ]);
        expect(names((await at('?type=all')).body)).toEqual([
          `${username}/alpha`,
          `${collaboratorName}/own`,
        ]);
        await get(`/users/${collaboratorName}/repos?type=private`).expect(422);
      });

      it('answers 404 for an account that does not exist', async () => {
        await get('/users/nobody-here-xyz/repos').expect(404);
      });
    });

    describe('GET /orgs/:org/repos', () => {
      it('lists what the viewer can read, newest first', async () => {
        const anonymous = await get(`/orgs/${org}/repos`).expect(200);
        expect(names(anonymous.body)).toEqual([`${org}/gamma`]);
        const member = await get(`/orgs/${org}/repos`, owner.key).expect(200);
        expect(names(member.body)).toEqual([`${org}/delta`, `${org}/gamma`]);
      });

      it('filters by type and answers 404 for an organization that does not exist', async () => {
        const at = (type: string) =>
          get(`/orgs/${org}/repos?type=${type}`, owner.key).expect(200);
        expect(names((await at('public')).body)).toEqual([`${org}/gamma`]);
        expect(names((await at('private')).body)).toEqual([`${org}/delta`]);
        expect(names((await at('sources')).body)).toEqual([
          `${org}/delta`,
          `${org}/gamma`,
        ]);
        expect((await at('forks')).body).toEqual([]);
        await get(`/orgs/${org}/repos?type=owner`, owner.key).expect(422);
        await get('/orgs/nobody-here-xyz/repos').expect(404);
      });
    });

    describe('PATCH /repos/:owner/:repo', () => {
      it('renames, describes and changes visibility, answering the repository', async () => {
        await create(owner, 'epsilon', 'public');
        const renamed = await send(
          'patch',
          `/repos/${username}/epsilon`,
          {
            name: 'epsilon-two',
            description: 'Second of its name',
            private: true,
          },
          owner.key,
        ).expect(200);
        expect(renamed.body).toMatchObject({
          name: 'epsilon-two',
          full_name: `${username}/epsilon-two`,
          description: 'Second of its name',
          private: true,
          visibility: 'private',
        });
        const visible = await send(
          'patch',
          `/repos/${username}/epsilon-two`,
          { visibility: 'public' },
          owner.key,
        ).expect(200);
        expect(visible.body.private).toBe(false);
        const unchanged = await send(
          'patch',
          `/repos/${username}/epsilon-two`,
          {},
          owner.key,
        ).expect(200);
        expect(unchanged.body.name).toBe('epsilon-two');
      });

      it('refuses anyone but an admin, and a token without the scope', async () => {
        await send('patch', `/repos/${username}/alpha`, {
          description: 'x',
        }).expect(401);
        await send(
          'patch',
          `/repos/${username}/alpha`,
          { description: 'x' },
          collaborator.key,
        ).expect(403);
        const readOnly = await scopedKey(app, owner.userId, ['read:org']);
        await send(
          'patch',
          `/repos/${username}/alpha`,
          { description: 'x' },
          readOnly,
        ).expect(403);
        const publicOnly = await scopedKey(app, owner.userId, ['public_repo']);
        await send(
          'patch',
          `/repos/${username}/alpha`,
          { private: true },
          publicOnly,
        ).expect(403);
        await send(
          'patch',
          `/repos/${username}/nothing-here`,
          {},
          owner.key,
        ).expect(404);
        await send(
          'patch',
          `/repos/${username}/alpha`,
          { default_branch: 'nope' },
          owner.key,
        ).expect(404);
      });
    });

    describe('DELETE /repos/:owner/:repo', () => {
      it('deletes with delete_repo, and refuses everyone else', async () => {
        await create(owner, 'zeta', 'public');
        await send('delete', `/repos/${username}/zeta`, {}).expect(401);
        await send(
          'delete',
          `/repos/${username}/zeta`,
          {},
          collaborator.key,
        ).expect(403);
        const withoutScope = await scopedKey(app, owner.userId, ['repo']);
        const refused = await send(
          'delete',
          `/repos/${username}/zeta`,
          {},
          withoutScope,
        ).expect(403);
        expect(refused.headers['x-accepted-oauth-scopes']).toBe('delete_repo');
        const deleter = await scopedKey(app, owner.userId, ['delete_repo']);
        await send('delete', `/repos/${username}/zeta`, {}, deleter).expect(
          204,
        );
        await get(`/repos/${username}/zeta`, owner.key).expect(404);
        await send('delete', `/repos/${username}/zeta`, {}, owner.key).expect(
          404,
        );
      });
    });
  },
);
