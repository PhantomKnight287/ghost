import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { AuthService } from '@thallesp/nestjs-better-auth';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Auth } from '../src/lib/auth.js';
import { S3Service } from '../src/services/s3/s3.service.js';
import { hasBackends, signUp, startApp } from './harness.js';

type Account = Awaited<ReturnType<typeof signUp>>;

describe.skipIf(!hasBackends)('organizations', () => {
  let app: INestApplication;
  let origin: string;
  let owner: Account;
  let alice: Account;
  let mallory: Account;
  let bob: Account;
  let organizationId: string;
  let aliceMemberId: string;
  let work: string;
  const stamp = Date.now();
  const ownerName = `founder${stamp}`;
  const aliceName = `alice${stamp}`;
  const org = `acme${stamp}`;

  const api = () => request(app.getHttpServer());
  const auth = () => app.get<AuthService<Auth>>(AuthService).api;
  const at = (suffix = '') => `/api/repositories/${org}/widget${suffix}`;
  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();
  // The server runs in this process, so anything that talks to it must not block the event loop.
  const push = (username: string, account: Account) =>
    promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        `${origin.replace('://', `://${username}:${account.key}@`)}/${org}/widget.git`,
        'HEAD:refs/heads/main',
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  const settings = (account: Account, changes: object) =>
    api()
      .patch(`/api/organizations/${org}/settings`)
      .set('cookie', account.cookie)
      .send(changes);
  const create = (account: Account, body: object) =>
    api().post('/api/repositories').set('cookie', account.cookie).send(body);

  beforeAll(async () => {
    ({ app, origin } = await startApp());
    owner = await signUp(app, ownerName);
    alice = await signUp(app, aliceName);
    mallory = await signUp(app, `mallory${stamp}`);
    bob = await signUp(app, `bob${stamp}`);

    const created = await auth().createOrganization({
      body: { name: 'Acme', slug: org },
      headers: new Headers({ cookie: owner.cookie }),
    });
    organizationId = created!.id;
    const member = await auth().addMember({
      body: { userId: alice.userId, role: 'member', organizationId },
    });
    aliceMemberId = member!.id;
    await settings(owner, { basePermission: 'write' }).expect(200);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-organizations-'));
    git('init', '-q', '-b', 'main');
    git('commit', '-q', '--allow-empty', '-m', 'first');
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('keeps usernames and organization slugs apart', async () => {
    await expect(
      auth().createOrganization({
        body: { name: 'Clash', slug: ownerName },
        headers: new Headers({ cookie: owner.cookie }),
      }),
    ).rejects.toThrow('A user already has that name');
    await expect(signUp(app, org)).rejects.toThrow(
      'An organization already uses that name',
    );
  });

  it('follows the organization’s policy on who creates repositories', async () => {
    await settings(alice, {
      membersCanCreatePrivateRepositories: false,
    }).expect(403);
    await settings(owner, {
      membersCanCreatePublicRepositories: false,
      membersCanCreatePrivateRepositories: false,
    }).expect(200);
    await create(alice, { name: 'widget', organization: org }).expect(403);
    await create(mallory, { name: 'widget', organization: org }).expect(404);

    const { body } = await create(owner, {
      name: 'widget',
      organization: org,
      visibility: 'private',
    }).expect(201);
    expect(body.slug).toBe('widget');

    // A slug is unique per namespace, so the founder's own `widget` is not suffixed.
    const personal = await create(owner, { name: 'widget' }).expect(201);
    expect(personal.body.slug).toBe('widget');
  });

  it('gives members their organization role on its repositories', async () => {
    const { body } = await api()
      .get(at())
      .set('cookie', alice.cookie)
      .expect(200);
    expect(body.viewerRole).toBe('write');
    await api().get(at()).set('cookie', mallory.cookie).expect(404);
    await api().get(at()).expect(401);

    await push(aliceName, alice);
    const branches = await api()
      .get(at('/branches'))
      .set('cookie', alice.cookie)
      .expect(200);
    expect(branches.body.branches).toEqual(['main']);
  });

  it('lists the repository under the organization and on the dashboard', async () => {
    const listed = await api()
      .get(`/api/repositories/${org}`)
      .set('cookie', alice.cookie)
      .expect(200);
    expect(
      listed.body.repositories.map((r: { slug: string }) => r.slug),
    ).toEqual(['widget']);
    const anonymous = await api().get(`/api/repositories/${org}`).expect(200);
    expect(anonymous.body.repositories).toEqual([]);

    const mine = await api()
      .get('/api/repositories')
      .set('cookie', alice.cookie)
      .expect(200);
    expect(mine.body.repositories).toEqual([
      expect.objectContaining({
        owner: org,
        slug: 'widget',
        viewerRole: 'write',
      }),
    ]);
  });

  it('shows the organization to everyone, and who is in it to members only', async () => {
    const publicView = await api().get(`/api/organizations/${org}`).expect(200);
    expect(publicView.body).toMatchObject({
      slug: org,
      name: 'Acme',
      repositoryCount: 0,
      members: [],
      viewerRole: null,
    });
    const outsider = await api()
      .get(`/api/organizations/${org}`)
      .set('cookie', mallory.cookie)
      .expect(200);
    expect(outsider.body.members).toEqual([]);

    const memberView = await api()
      .get(`/api/organizations/${org}`)
      .set('cookie', alice.cookie)
      .expect(200);
    expect(memberView.body.viewerRole).toBe('member');
    expect(
      memberView.body.members.map((m: { username: string }) => m.username),
    ).toEqual([ownerName, aliceName]);

    const organizationsOf = (account?: Account) => {
      const call = api().get(`/api/users/${aliceName}/organizations`);
      return (account ? call.set('cookie', account.cookie) : call).expect(200);
    };
    expect((await organizationsOf()).body.organizations).toEqual([]);
    expect((await organizationsOf(mallory)).body.organizations).toEqual([]);
    expect((await organizationsOf(owner)).body.organizations).toEqual([
      expect.objectContaining({ slug: org }),
    ]);

    const mine = await api()
      .get('/api/organizations')
      .set('cookie', owner.cookie)
      .expect(200);
    expect(mine.body.organizations).toEqual([
      expect.objectContaining({ slug: org, viewerRole: 'owner' }),
    ]);
  });

  it('invites a user by username without revealing their email', async () => {
    const carol = await signUp(app, `carol${stamp}`);
    const invite = (account: Account, username: string, role = 'member') =>
      api()
        .post(`/api/organizations/${org}/invitations`)
        .set('cookie', account.cookie)
        .send({ username, role });

    await invite(alice, `carol${stamp}`).expect(403);
    await invite(owner, `nobody${stamp}`).expect(404);
    await invite(owner, aliceName).expect(400);
    await invite(owner, `carol${stamp}`).expect(204);

    // Carol never verified her email, which Better Auth's own listing insists on.
    const { body: received } = await api()
      .get('/api/invitations/organizations')
      .set('cookie', carol.cookie)
      .expect(200);
    expect(received.invitations).toEqual([
      expect.objectContaining({
        organization: expect.objectContaining({ slug: org }),
        role: 'member',
        invitedByUsername: ownerName,
      }),
    ]);
    await auth().acceptInvitation({
      body: { invitationId: received.invitations[0].id },
      headers: new Headers({ cookie: carol.cookie }),
    });

    const { body } = await api()
      .get(`/api/organizations/${org}`)
      .set('cookie', carol.cookie)
      .expect(200);
    expect(body.viewerRole).toBe('member');
  });

  it('lets an admin set and remove the organization logo', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const upload = (account: Account) =>
      api()
        .put(`/api/organizations/${org}/logo`)
        .set('cookie', account.cookie)
        .set('Content-Type', 'image/png')
        .send(png);

    await upload(alice).expect(403);
    await upload(mallory).expect(404);
    const { body } = await upload(owner).expect(200);

    const profile = await api().get(`/api/organizations/${org}`).expect(200);
    expect(profile.body.logo).toBe(body.url);
    const served = await api()
      .get(new URL(body.url).pathname)
      .expect(200)
      .expect('Content-Type', 'image/png');
    expect(Buffer.from(served.body)).toEqual(png);

    await api()
      .delete(`/api/organizations/${org}/logo`)
      .set('cookie', owner.cookie)
      .expect(204);
    const cleared = await api().get(`/api/organizations/${org}`).expect(200);
    expect(cleared.body.logo).toBeNull();
  });

  it('removes the logo from storage with the organization', async () => {
    const temporary = await auth().createOrganization({
      body: { name: 'Temporary', slug: `temp${stamp}` },
      headers: new Headers({ cookie: owner.cookie }),
    });
    await api()
      .put(`/api/organizations/temp${stamp}/logo`)
      .set('cookie', owner.cookie)
      .set('Content-Type', 'image/png')
      .send(Buffer.from([0x89, 0x50, 0x4e, 0x47]))
      .expect(200);
    const stored = async () => {
      const s3 = app.get(S3Service);
      const listed = await s3.listObjectsV2({
        Bucket: s3.bucket,
        Prefix: `avatars/${temporary!.id}/`,
      });
      return listed.Contents ?? [];
    };
    expect(await stored()).toHaveLength(1);

    await auth().deleteOrganization({
      body: { organizationId: temporary!.id },
      headers: new Headers({ cookie: owner.cookie }),
    });
    expect(await stored()).toEqual([]);
  });

  it('reserves route names and reports a name held in the other namespace as taken', async () => {
    await expect(signUp(app, 'dashboard')).rejects.toThrow(
      'That name is reserved',
    );
    await expect(
      auth().createOrganization({
        body: { name: 'Settings', slug: 'settings' },
        headers: new Headers({ cookie: owner.cookie }),
      }),
    ).rejects.toThrow('That name is reserved');

    const { available } = await auth().isUsernameAvailable({
      body: { username: org },
    });
    expect(available).toBe(false);
    await expect(
      auth().checkOrganizationSlug({
        body: { slug: aliceName },
        headers: new Headers({ cookie: owner.cookie }),
      }),
    ).rejects.toThrow('A user already has that name');

    const { body } = await create(owner, { name: 'settings' }).expect(201);
    expect(body.slug).not.toBe('settings');
  });

  it('gives a team its role on a repository', async () => {
    await auth().addMember({
      body: { userId: bob.userId, role: 'member', organizationId },
    });
    const team = await auth().createTeam({
      body: { name: 'Core', organizationId },
      headers: new Headers({ cookie: owner.cookie }),
    });
    await auth().addTeamMember({
      body: { teamId: team!.id, userId: bob.userId, organizationId },
      headers: new Headers({ cookie: owner.cookie }),
    });
    const role = async () =>
      (await api().get(at()).set('cookie', bob.cookie).expect(200)).body
        .viewerRole;

    expect(await role()).toBe('write');
    await api()
      .put(at(`/teams/${team!.id}`))
      .set('cookie', alice.cookie)
      .send({ role: 'maintain' })
      .expect(403);
    await api()
      .put(at(`/teams/${team!.id}`))
      .set('cookie', owner.cookie)
      .send({ role: 'maintain' })
      .expect(204);
    expect(await role()).toBe('maintain');

    const { body } = await api()
      .get(at('/teams'))
      .set('cookie', owner.cookie)
      .expect(200);
    // Better Auth gives every organization a default team, which has no access here.
    expect(body.teams).toContainEqual(
      expect.objectContaining({ name: 'Core', role: 'maintain' }),
    );
    expect(
      body.teams.filter((t: { role: string | null }) => t.role !== null),
    ).toHaveLength(1);

    await api()
      .delete(at(`/teams/${team!.id}`))
      .set('cookie', owner.cookie)
      .expect(204);
    expect(await role()).toBe('write');
  });

  it('counts commits to an organization repository in the contribution graph', async () => {
    git(
      '-c',
      `user.email=${aliceName}@example.com`,
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'from alice',
    );
    await push(aliceName, alice);

    await vi.waitFor(
      async () => {
        const { body } = await api()
          .get(`/api/users/${aliceName}/contributions`)
          .set('cookie', alice.cookie)
          .expect(200);
        expect(body.totalContributions).toBe(1);
      },
      { timeout: 10_000, interval: 250 },
    );
    // Private to the organization, so nobody outside it sees the count.
    const outside = await api()
      .get(`/api/users/${aliceName}/contributions`)
      .expect(200);
    expect(outside.body.totalContributions).toBe(0);
  });

  it('forks into an organization an admin runs', async () => {
    await create(owner, { name: 'lib', visibility: 'public' }).expect(201);
    const fork = (account: Account) =>
      api()
        .post(`/api/repositories/${ownerName}/lib/fork`)
        .set('cookie', account.cookie)
        .send({ name: 'lib', visibility: 'public', organization: org });

    await fork(alice).expect(403);
    const { body } = await fork(owner).expect(201);
    expect(body).toMatchObject({ username: org, slug: 'lib' });
    await fork(owner).expect(409);
    await api().get(`/api/repositories/${org}/lib`).expect(200);
  });

  it('transfers at once where the owner holds the destination, and on acceptance elsewhere', async () => {
    await create(owner, { name: 'gadget', visibility: 'private' }).expect(201);
    const transfer = (from: string, to: string, account = owner) =>
      api()
        .post(`/api/repositories/${from}/gadget/transfer`)
        .set('cookie', account.cookie)
        .send({ owner: to });

    await transfer(ownerName, org, alice).expect(404);
    await api()
      .post(`/api/repositories/${ownerName}/widget/transfer`)
      .set('cookie', owner.cookie)
      .send({ owner: org })
      .expect(409);

    const { body } = await transfer(ownerName, org).expect(201);
    expect(body).toMatchObject({
      username: org,
      slug: 'gadget',
      pending: false,
    });
    // The old name still leads there.
    const followed = await api()
      .get(`/api/repositories/${ownerName}/gadget`)
      .set('cookie', owner.cookie)
      .expect(200);
    expect(followed.body.owner).toBe(org);
    const moved = await api()
      .get(`/api/repositories/${org}/gadget`)
      .set('cookie', alice.cookie)
      .expect(200);
    expect(moved.body.viewerRole).toBe('write');
    await transfer(org, ownerName, alice).expect(403);

    // To someone else, it waits for them.
    const offered = await transfer(org, aliceName).expect(201);
    expect(offered.body).toMatchObject({ username: org, pending: true });
    const incoming = await api()
      .get('/api/transfers')
      .set('cookie', alice.cookie)
      .expect(200);
    expect(incoming.body.transfers).toEqual([
      expect.objectContaining({
        repository: expect.objectContaining({ owner: org, slug: 'gadget' }),
        to: aliceName,
        requestedByUsername: ownerName,
      }),
    ]);
    await api()
      .post(`/api/transfers/${incoming.body.transfers[0].repositoryId}/accept`)
      .set('cookie', mallory.cookie)
      .expect(404);
    await api()
      .post(`/api/transfers/${incoming.body.transfers[0].repositoryId}/accept`)
      .set('cookie', alice.cookie)
      .expect(201);
    const accepted = await api()
      .get(`/api/repositories/${aliceName}/gadget`)
      .set('cookie', alice.cookie)
      .expect(200);
    expect(accepted.body.viewerRole).toBe('owner');
  });

  it('waits for an organization admin when a member transfers in, and lets either side call it off', async () => {
    const offer = () =>
      api()
        .post(`/api/repositories/${aliceName}/gadget/transfer`)
        .set('cookie', alice.cookie)
        .send({ owner: org });
    const incoming = async (account: Account) =>
      (
        await api()
          .get('/api/transfers')
          .set('cookie', account.cookie)
          .expect(200)
      ).body.transfers as { repositoryId: string; to: string }[];
    const callOff = (repositoryId: string, account: Account) =>
      api()
        .delete(`/api/transfers/${repositoryId}`)
        .set('cookie', account.cookie);

    // Alice is only a member, so the organization's admins decide.
    const { body } = await offer().expect(201);
    expect(body).toMatchObject({ username: aliceName, pending: true });
    const [declined] = await incoming(owner);
    expect(declined).toMatchObject({ to: org });
    await callOff(declined.repositoryId, mallory).expect(404);
    await callOff(declined.repositoryId, owner).expect(204);
    expect(await incoming(owner)).toEqual([]);

    await offer().expect(201);
    const [withdrawn] = await incoming(owner);
    await callOff(withdrawn.repositoryId, alice).expect(204);
    expect(await incoming(owner)).toEqual([]);

    await offer().expect(201);
    const [accepted] = await incoming(owner);
    await api()
      .post(`/api/transfers/${accepted.repositoryId}/accept`)
      .set('cookie', owner.cookie)
      .expect(201);
    const moved = await api()
      .get(`/api/repositories/${org}/gadget`)
      .set('cookie', owner.cookie)
      .expect(200);
    expect(moved.body.viewerRole).toBe('owner');
  });

  it('keeps private repositories to teams when the base permission is none', async () => {
    await settings(owner, { basePermission: null }).expect(200);
    await api().get(at()).set('cookie', bob.cookie).expect(404);
    const listed = await api()
      .get(`/api/repositories/${org}`)
      .set('cookie', bob.cookie)
      .expect(200);
    // Its public repositories are still listed; the private `widget` is not.
    expect(
      listed.body.repositories.map((r: { slug: string }) => r.slug),
    ).not.toContain('widget');

    const current = await api()
      .get(`/api/organizations/${org}/settings`)
      .set('cookie', owner.cookie)
      .expect(200);
    expect(current.body.basePermission).toBeNull();
    await api()
      .get(`/api/organizations/${org}/settings`)
      .set('cookie', alice.cookie)
      .expect(403);
    await settings(owner, { basePermission: 'write' }).expect(200);
  });

  it('lists and removes outside collaborators', async () => {
    await api()
      .put(at(`/collaborators/${`mallory${stamp}`}`))
      .set('cookie', owner.cookie)
      .send({ role: 'read' })
      .expect(200);
    const outside = await api()
      .get(`/api/organizations/${org}/outside-collaborators`)
      .set('cookie', owner.cookie)
      .expect(200);
    expect(outside.body.collaborators).toEqual([
      expect.objectContaining({
        username: `mallory${stamp}`,
        repositories: [{ slug: 'widget', role: 'read', pending: true }],
      }),
    ]);
    await api()
      .delete(`/api/organizations/${org}/outside-collaborators/mallory${stamp}`)
      .set('cookie', owner.cookie)
      .expect(204);
    const after = await api()
      .get(`/api/organizations/${org}/outside-collaborators`)
      .set('cookie', owner.cookie)
      .expect(200);
    expect(after.body.collaborators).toEqual([]);
  });

  it('shows pinned repositories and public members on the profile', async () => {
    await api()
      .put(`/api/organizations/${org}/pins`)
      .set('cookie', owner.cookie)
      .send({ repositories: ['lib', 'widget'] })
      .expect(204);
    await api()
      .put(`/api/organizations/${org}/public-members`)
      .set('cookie', alice.cookie)
      .expect(204);
    await settings(owner, { description: 'We make widgets' }).expect(200);

    const { body } = await api().get(`/api/organizations/${org}`).expect(200);
    expect(body.description).toBe('We make widgets');
    // `widget` is private, so the public sees only `lib`.
    expect(body.pinned.map((r: { slug: string }) => r.slug)).toEqual(['lib']);
    expect(body.members.map((m: { username: string }) => m.username)).toEqual([
      aliceName,
    ]);
    const of = await api()
      .get(`/api/users/${aliceName}/organizations`)
      .expect(200);
    expect(of.body.organizations).toEqual([
      expect.objectContaining({ slug: org }),
    ]);

    const inside = await api()
      .get(`/api/organizations/${org}`)
      .set('cookie', alice.cookie)
      .expect(200);
    expect(inside.body.pinned.map((r: { slug: string }) => r.slug)).toEqual([
      'lib',
      'widget',
    ]);

    await api()
      .delete(`/api/organizations/${org}/public-members`)
      .set('cookie', mallory.cookie)
      .expect(404);
    await api()
      .delete(`/api/organizations/${org}/public-members`)
      .set('cookie', alice.cookie)
      .expect(204);
    const hidden = await api().get(`/api/organizations/${org}`).expect(200);
    expect(hidden.body.members).toEqual([]);
  });

  it('lets a team maintainer manage the team without administering the organization', async () => {
    const team = (suffix = '') =>
      `/api/organizations/${org}/teams/core${suffix}`;
    const { body } = await api()
      .get(team())
      .set('cookie', bob.cookie)
      .expect(200);
    expect(body).toMatchObject({ name: 'Core', viewerCanManage: false });
    expect(body.members.map((m: { username: string }) => m.username)).toEqual([
      `bob${stamp}`,
    ]);

    await api()
      .put(team(`/members/${aliceName}`))
      .set('cookie', bob.cookie)
      .expect(403);
    await api()
      .put(team(`/maintainers/bob${stamp}`))
      .set('cookie', owner.cookie)
      .expect(204);
    await api()
      .put(team(`/members/${aliceName}`))
      .set('cookie', bob.cookie)
      .expect(204);
    await api()
      .put(team(`/members/mallory${stamp}`))
      .set('cookie', bob.cookie)
      .expect(400);

    const updated = await api()
      .get(team())
      .set('cookie', bob.cookie)
      .expect(200);
    expect(updated.body.viewerCanManage).toBe(true);
    expect(updated.body.members).toEqual([
      expect.objectContaining({ username: aliceName, maintainer: false }),
      expect.objectContaining({ username: `bob${stamp}`, maintainer: true }),
    ]);
    const listed = await api()
      .get(`/api/organizations/${org}/teams`)
      .set('cookie', alice.cookie)
      .expect(200);
    expect(listed.body.teams).toContainEqual(
      expect.objectContaining({ slug: 'core', memberCount: 2 }),
    );
    await api().get(team()).set('cookie', mallory.cookie).expect(404);
  });

  it('dismisses maintainers, and stops a member leaving the team from maintaining it', async () => {
    const team = (suffix = '') =>
      `/api/organizations/${org}/teams/core${suffix}`;
    const canManage = async () =>
      (await api().get(team()).set('cookie', bob.cookie).expect(200)).body
        .viewerCanManage;

    await api()
      .delete(team(`/maintainers/bob${stamp}`))
      .set('cookie', owner.cookie)
      .expect(204);
    expect(await canManage()).toBe(false);

    await api()
      .put(team(`/maintainers/bob${stamp}`))
      .set('cookie', owner.cookie)
      .expect(204);
    await api()
      .delete(team(`/members/bob${stamp}`))
      .set('cookie', owner.cookie)
      .expect(204);
    await api()
      .put(team(`/members/bob${stamp}`))
      .set('cookie', owner.cookie)
      .expect(204);
    const { body } = await api()
      .get(team())
      .set('cookie', owner.cookie)
      .expect(200);
    expect(body.members).toContainEqual(
      expect.objectContaining({ username: `bob${stamp}`, maintainer: false }),
    );
    expect(await canManage()).toBe(false);
  });

  it('refuses to fork private repositories unless the organization allows it', async () => {
    const fork = () =>
      api()
        .post(at('/fork'))
        .set('cookie', alice.cookie)
        .send({ name: 'widget', visibility: 'private' });
    await fork().expect(403);
    await settings(owner, { allowPrivateForks: true }).expect(200);
    await fork().expect(201);
  });

  it('records the organization default branch on new repositories', async () => {
    await settings(owner, { defaultBranch: 'trunk' }).expect(200);
    await create(owner, { name: 'trunked', organization: org }).expect(201);
    const { body } = await api()
      .get(`/api/repositories/${org}/trunked`)
      .set('cookie', owner.cookie)
      .expect(200);
    expect(body.defaultBranch).toBe('trunk');
  });

  it('narrows repository search to one owner with org:', async () => {
    const { body } = await api()
      .get(`/api/search/repositories?q=${encodeURIComponent(`org:${org} li`)}`)
      .expect(200);
    expect(
      body.repositories.map(
        (r: { owner: string; slug: string }) => `${r.owner}/${r.slug}`,
      ),
    ).toEqual([`${org}/lib`]);
  });

  it('matches no code for an owner qualifier alone, or an owner with no public repositories', async () => {
    const search = (q: string) =>
      api()
        .get(`/api/search/code?q=${encodeURIComponent(q)}`)
        .expect(200);
    expect((await search(`org:${org}`)).body.files).toEqual([]);
    expect((await search(`org:nobody${stamp} widget`)).body.files).toEqual([]);
  });

  it('lets members create what the policy allows', async () => {
    await settings(owner, { membersCanCreatePublicRepositories: true }).expect(
      200,
    );
    await create(alice, {
      name: 'gizmo',
      organization: org,
      visibility: 'public',
    }).expect(201);
    await create(alice, {
      name: 'secret',
      organization: org,
      visibility: 'private',
    }).expect(403);
  });

  it('refuses to delete an organization that still has repositories', async () => {
    await expect(
      auth().deleteOrganization({
        body: { organizationId },
        headers: new Headers({ cookie: owner.cookie }),
      }),
    ).rejects.toThrow(
      'Delete or transfer the organization’s repositories first',
    );
    await api().get(`/api/organizations/${org}`).expect(200);
  });

  it('takes access away with membership', async () => {
    await auth().removeMember({
      body: { memberIdOrEmail: aliceMemberId, organizationId },
      headers: new Headers({ cookie: owner.cookie }),
    });
    await api().get(at()).set('cookie', alice.cookie).expect(404);
  });
});
