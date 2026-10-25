import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Auth } from '../src/lib/auth.js';
import { hasBackends, signUp, startApp } from './harness.js';

/** Owner names and repository slugs are unique ignoring case, so a path naming one in any case reaches it, as on GitHub (#109). The canonical name is what comes back. */
describe.skipIf(!hasBackends)(
  'owner names and repository slugs in any case',
  () => {
    let app: INestApplication;
    let owner: Awaited<ReturnType<typeof signUp>>;
    const stamp = Date.now();
    const username = `casey${stamp}`;
    const shouted = username.toUpperCase();
    const org = `CaseOrg${stamp}`;
    const api = () => request(app.getHttpServer());
    const v3 = (path: string) =>
      api().get(`/api/v3${path}`).set('authorization', `token ${owner.key}`);

    beforeAll(async () => {
      ({ app } = await startApp());
      owner = await signUp(app, username);
      await app.get<AuthService<Auth>>(AuthService).api.createOrganization({
        body: { name: 'Case', slug: org },
        headers: new Headers({ cookie: owner.cookie }),
      });
      for (const body of [
        { name: 'mine', visibility: 'public' },
        { name: 'theirs', visibility: 'public', organization: org },
        { name: 'old-name', visibility: 'public' },
      ]) {
        await api()
          .post('/api/repositories')
          .set('cookie', owner.cookie)
          .send(body)
          .expect(201);
      }
    });

    afterAll(async () => {
      await app?.close();
    });

    it('answers GET /api/v3/repos/:owner/:repo with the canonical owner', async () => {
      const { body } = await v3(`/repos/${shouted}/mine`).expect(200);
      expect(body).toMatchObject({
        full_name: `${username}/mine`,
        owner: { login: username },
      });
      expect(body.html_url).toMatch(new RegExp(`/${username}/mine$`));

      const theirs = await v3(`/repos/${org.toLowerCase()}/theirs`).expect(200);
      expect(theirs.body).toMatchObject({
        full_name: `${org}/theirs`,
        owner: { login: org },
      });
    });

    it('answers GET /api/v3/users/:login for a user and an organization', async () => {
      const user = await v3(`/users/${shouted}`).expect(200);
      expect(user.body.login).toBe(username);
      const organization = await v3(`/users/${org.toLowerCase()}`).expect(200);
      expect(organization.body.login).toBe(org);
    });

    it('answers GET /api/repositories/:owner/:slug with the canonical owner', async () => {
      const mine = await api()
        .get(`/api/repositories/${shouted}/mine`)
        .set('cookie', owner.cookie)
        .expect(200);
      expect(mine.body.owner).toBe(username);
      const theirs = await api()
        .get(`/api/repositories/${org.toLowerCase()}/theirs`)
        .set('cookie', owner.cookie)
        .expect(200);
      expect(theirs.body.owner).toBe(org);
    });

    it('answers GET /api/organizations/:slug with the canonical slug', async () => {
      const { body } = await api()
        .get(`/api/organizations/${org.toLowerCase()}`)
        .expect(200);
      expect(body.slug).toBe(org);
    });

    it('lists an owner’s repositories under any case of their name', async () => {
      const profile = await api()
        .get(`/api/repositories/${shouted}`)
        .expect(200);
      expect(profile.body.repositories).toContainEqual(
        expect.objectContaining({ slug: 'mine' }),
      );
      const filtered = await api()
        .get(`/api/repositories?q=org:${org.toLowerCase()}`)
        .set('cookie', owner.cookie)
        .expect(200);
      expect(filtered.body.repositories).toEqual([
        expect.objectContaining({ owner: org, slug: 'theirs' }),
      ]);
    });

    it('resolves GraphQL repository(owner:) in any case', async () => {
      const { body } = await api()
        .post('/api/graphql')
        .set('authorization', `token ${owner.key}`)
        .send({
          query:
            'query($owner: String!) { repository(owner: $owner, name: "theirs") { nameWithOwner } }',
          variables: { owner: org.toLowerCase() },
        })
        .expect(200);
      expect(body.data.repository.nameWithOwner).toBe(`${org}/theirs`);
    });

    it('serves git over HTTP under any case of the owner', async () => {
      await api()
        .get(`/${shouted}/mine.git/info/refs?service=git-upload-pack`)
        .expect(200);
    });

    it('answers GET /api/v3/repos/:owner/:repo for a slug in any case', async () => {
      const { body } = await v3(`/repos/${username}/MINE`).expect(200);
      expect(body).toMatchObject({ full_name: `${username}/mine` });
      expect(body.html_url).toMatch(new RegExp(`/${username}/mine$`));
      const both = await v3(`/repos/${org.toLowerCase()}/Theirs`).expect(200);
      expect(both.body.full_name).toBe(`${org}/theirs`);
    });

    it('answers GET /api/repositories/:owner/:slug for a slug in any case', async () => {
      const { body } = await api()
        .get(`/api/repositories/${username}/Mine`)
        .set('cookie', owner.cookie)
        .expect(200);
      expect(body).toMatchObject({ owner: username, slug: 'mine' });
    });

    it('resolves GraphQL repository(name:) in any case', async () => {
      const { body } = await api()
        .post('/api/graphql')
        .set('authorization', `token ${owner.key}`)
        .send({
          query:
            'query($owner: String!) { repository(owner: $owner, name: "THEIRS") { nameWithOwner } }',
          variables: { owner: org },
        })
        .expect(200);
      expect(body.data.repository.nameWithOwner).toBe(`${org}/theirs`);
    });

    it('serves git over HTTP under any case of the slug', async () => {
      await api()
        .get(`/${username}/MINE.git/info/refs?service=git-upload-pack`)
        .expect(200);
    });

    it('follows a renamed repository from its old slug in any case', async () => {
      await api()
        .patch(`/api/repositories/${username}/old-name`)
        .set('cookie', owner.cookie)
        .send({ name: 'new-name' })
        .expect(200);
      const { body } = await api()
        .get(`/api/repositories/${shouted}/OLD-NAME`)
        .set('cookie', owner.cookie)
        .expect(200);
      expect(body).toMatchObject({ owner: username, slug: 'new-name' });
    });

    it('still answers 404 for a slug that does not exist in any case', async () => {
      await v3(`/repos/${username}/MISSING`).expect(404);
    });

    it('serves git over HTTP when the .git suffix is in capitals', async () => {
      await api()
        .get(`/${shouted}/MINE.GIT/info/refs?service=git-upload-pack`)
        .expect(200);
    });

    it('lets an owner administer an organization whose slug has capitals, in any case', async () => {
      for (const slug of [org, org.toLowerCase()]) {
        await api()
          .get(`/api/organizations/${slug}/settings`)
          .set('cookie', owner.cookie)
          .expect(200);
      }
    });

    it('lists the repositories of an organization whose slug has capitals, in any case', async () => {
      for (const slug of [org, org.toLowerCase()]) {
        const { body } = await api()
          .get(`/api/repositories/${slug}`)
          .expect(200);
        expect(body.repositories).toEqual([
          expect.objectContaining({ slug: 'theirs' }),
        ]);
      }
    });

    it('searches public repositories under an org: qualifier in any case', async () => {
      for (const slug of [org, org.toLowerCase()]) {
        const { body } = await api()
          .get(`/api/search/repositories?q=org:${slug}`)
          .expect(200);
        expect(body.repositories).toEqual([
          expect.objectContaining({ owner: org, slug: 'theirs' }),
        ]);
      }
    });

    it('still answers 404 for an owner that does not exist in any case', async () => {
      await v3(`/repos/nobody${stamp}/mine`).expect(404);
      await v3(`/users/nobody${stamp}`).expect(404);
    });
  },
);
