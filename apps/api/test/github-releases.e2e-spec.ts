import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { hasBackends, signUp, startApp } from './harness.js';

/** The release routes and fields gh's own suite (gh-cli.e2e-spec.ts) does not reach: paging, uploads of any type, labels, renames, refusals and the GraphQL release fields. */
describe.skipIf(!hasBackends)('GitHub releases', () => {
  let app: INestApplication;
  let work: string;
  let owner: { cookie: string; key: string; userId: string };
  let reader: { cookie: string; key: string; userId: string };
  const username = `ghreleases${Date.now()}`;
  const repo = `/repos/${username}/tools`;
  const http = () => request(app.getHttpServer());
  const get = (path: string, token = owner.key) =>
    http().get(`/api/v3${path}`).set('authorization', `token ${token}`);
  const send = (
    method: 'post' | 'patch' | 'delete',
    path: string,
    body: object = {},
    token = owner.key,
  ) =>
    http()
      [method](`/api/v3${path}`)
      .set('authorization', `token ${token}`)
      .send(body);
  const upload = (
    url: string,
    bytes: string,
    type: string,
    token = owner.key,
  ) =>
    http()
      .post(new URL(url).pathname + new URL(url).search)
      .set('authorization', `token ${token}`)
      .set('content-type', type)
      .send(bytes);
  /** A release's upload_url with its template filled in. */
  const uploadUrl = (template: string, query: Record<string, string>) =>
    `${template.replace(/\{.*\}$/, '')}?${new URLSearchParams(query)}`;
  const graphql = async (query: string, token = owner.key) => {
    const { body } = await http()
      .post('/api/graphql')
      .set('authorization', `token ${token}`)
      .send({ query })
      .expect(200);
    return body;
  };

  beforeAll(async () => {
    let origin: string;
    ({ app, origin } = await startApp());
    owner = await signUp(app, username);
    reader = await signUp(app, `${username}r`);
    await http()
      .post('/api/repositories')
      .set('cookie', owner.cookie)
      .send({ name: 'tools', visibility: 'public' })
      .expect(201);

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-ghreleases-'));
    const git = (...args: string[]) =>
      execFileSync(
        'git',
        ['-c', 'user.name=E2E', '-c', 'user.email=e2e@example.com', ...args],
        { cwd: work },
      );
    git('init', '-q', '-b', 'main');
    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-q', '-m', 'first');
    git('checkout', '-q', '-b', 'feature');
    // The server runs in this process, so the push must not block the event loop.
    await promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        `${origin.replace('://', `://${username}:${owner.key}@`)}/${username}/tools.git`,
        'main',
        'feature',
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('creates a release with its tag and answers it in GitHub shape', async () => {
    const { body, headers } = await send('post', `${repo}/releases`, {
      tag_name: 'v1.0',
      name: 'First',
      body: 'Notes',
      make_latest: 'legacy',
    }).expect(201);
    expect(headers.location).toBe(body.url);
    expect(body).toMatchObject({
      id: expect.any(Number),
      node_id: expect.stringMatching(/^RE_/),
      tag_name: 'v1.0',
      target_commitish: expect.stringMatching(/^[0-9a-f]{40}$/),
      name: 'First',
      body: 'Notes',
      draft: false,
      prerelease: false,
      immutable: false,
      tarball_url: null,
      zipball_url: null,
      published_at: expect.any(String),
      author: expect.objectContaining({ login: username }),
      assets: [],
    });
    expect(body.url).toMatch(
      new RegExp(`/api/v3/repos/${username}/tools/releases/${body.id}$`),
    );
    expect(body.html_url).toMatch(/\/tools\/releases\/tag\/v1\.0$/);
    expect(body.upload_url).toMatch(
      new RegExp(
        `/api/uploads/repos/${username}/tools/releases/${body.id}/assets\\{\\?name,label\\}$`,
      ),
    );
    expect((await get(`${repo}/releases/${body.id}`).expect(200)).body).toEqual(
      body,
    );
    expect((await get(`${repo}/releases/latest`).expect(200)).body.id).toBe(
      body.id,
    );
    expect((await get(`${repo}/releases/tags/v1.0`).expect(200)).body.id).toBe(
      body.id,
    );
  });

  it('answers what Ghost cannot do, and a duplicate tag, as GitHub does', async () => {
    expect(
      (await send('post', `${repo}/releases`, { tag_name: 'v1.0' }).expect(422))
        .body,
    ).toMatchObject({
      message: 'Validation Failed',
      errors: [
        { resource: 'Release', field: 'tag_name', code: 'already_exists' },
      ],
    });
    expect(
      (
        await send('post', `${repo}/releases`, {
          tag_name: 'v9',
          target_commitish: 'nope',
        }).expect(422)
      ).body.errors,
    ).toEqual([
      { resource: 'Release', field: 'target_commitish', code: 'invalid' },
    ]);
    expect(
      (
        await send('post', `${repo}/releases`, {
          tag_name: 'bad..tag',
        }).expect(422)
      ).body.errors,
    ).toEqual([{ resource: 'Release', field: 'tag_name', code: 'invalid' }]);
    await send('post', `${repo}/releases`, {
      tag_name: 'v9',
      generate_release_notes: true,
    }).expect(422);
    await send('post', `${repo}/releases`, {
      tag_name: 'v9',
      discussion_category_name: 'Announcements',
    }).expect(404);
    await send(
      'post',
      `${repo}/releases`,
      { tag_name: 'v9' },
      reader.key,
    ).expect(403);
    await http()
      .post(`/api/v3${repo}/releases`)
      .send({ tag_name: 'v9' })
      .expect(401);
  });

  it('keeps a draft out of the tag route and from readers, but not from GraphQL', async () => {
    const { body: draft } = await send('post', `${repo}/releases`, {
      tag_name: 'v2.0',
      target_commitish: 'feature',
      draft: true,
    }).expect(201);
    expect(draft).toMatchObject({ draft: true, published_at: null });
    await get(`${repo}/releases/tags/v2.0`).expect(404);
    await get(`${repo}/releases/${draft.id}`, reader.key).expect(404);
    expect(
      (await get(`${repo}/releases/${draft.id}`).expect(200)).body.id,
    ).toBe(draft.id);

    const { data } = await graphql(`{
      repository(owner: "${username}", name: "tools") {
        release(tagName: "v2.0") { databaseId isDraft tagName }
        missing: release(tagName: "v8") { id }
      }
    }`);
    expect(data.repository).toEqual({
      release: { databaseId: draft.id, isDraft: true, tagName: 'v2.0' },
      missing: null,
    });
  });

  it('lists releases over REST with paging, and over GraphQL in either order', async () => {
    const all = await get(`${repo}/releases`).expect(200);
    expect(
      all.body.map((release: { tag_name: string }) => release.tag_name),
    ).toEqual(['v2.0', 'v1.0']);
    const first = await get(`${repo}/releases?per_page=1`).expect(200);
    expect(first.body).toHaveLength(1);
    expect(first.headers.link).toContain('rel="next"');
    expect(
      (await get(`${repo}/releases`, reader.key).expect(200)).body,
    ).toHaveLength(1);

    const list = (orderBy: string, after = '') =>
      graphql(`{
        repository(owner: "${username}", name: "tools") {
          releases(first: 1, orderBy: ${orderBy}${after && `, after: "${after}"`}) {
            totalCount
            nodes { tagName isLatest isDraft isPrerelease name publishedAt createdAt url }
            pageInfo { hasNextPage endCursor }
          }
        }
      }`);
    const page = (await list('{ field: CREATED_AT, direction: DESC }')).data
      .repository.releases;
    expect(page).toMatchObject({
      totalCount: 2,
      nodes: [{ tagName: 'v2.0', isDraft: true, isLatest: false }],
      pageInfo: { hasNextPage: true },
    });
    const next = (
      await list(
        '{ field: CREATED_AT, direction: DESC }',
        page.pageInfo.endCursor,
      )
    ).data.repository.releases;
    expect(next).toMatchObject({
      nodes: [{ tagName: 'v1.0', isLatest: true, name: 'First' }],
      pageInfo: { hasNextPage: false },
    });
    expect(next.nodes[0].url).toMatch(/\/tools\/releases\/tag\/v1\.0$/);
    // a nameless release sorts by its tag, so `First` comes before `v2.0`
    expect(
      (await list('{ field: NAME, direction: ASC }')).data.repository.releases
        .nodes,
    ).toEqual([expect.objectContaining({ tagName: 'v1.0' })]);
  });

  it('uploads assets of any type with a label, serves, renames and deletes them', async () => {
    const { body: release } = await get(`${repo}/releases/tags/v1.0`).expect(
      200,
    );
    const json = await upload(
      uploadUrl(release.upload_url, { name: 'data.json', label: 'Data' }),
      '{"a":1}',
      'application/json',
    ).expect(201);
    expect(json.body).toMatchObject({
      id: expect.any(Number),
      node_id: expect.stringMatching(/^RA_/),
      name: 'data.json',
      label: 'Data',
      state: 'uploaded',
      content_type: 'application/json',
      size: 7,
      digest: null,
      download_count: 0,
      uploader: expect.objectContaining({ login: username }),
    });
    expect(json.body.url).toMatch(
      new RegExp(`/releases/assets/${json.body.id}$`),
    );
    expect(json.body.browser_download_url).toMatch(
      /\/tools\/releases\/download\/v1\.0\/data\.json$/,
    );
    await upload(
      uploadUrl(release.upload_url, { name: 'notes.txt', label: '' }),
      'hello\n',
      'text/plain; charset=utf-8',
    ).expect(201);

    expect(
      (
        await upload(
          uploadUrl(release.upload_url, { name: 'data.json' }),
          'again',
          'application/json',
        ).expect(422)
      ).body.errors,
    ).toEqual([
      { resource: 'ReleaseAsset', field: 'name', code: 'already_exists' },
    ]);
    await upload(
      uploadUrl(release.upload_url, { name: 'x.bin' }),
      'x',
      'not a type',
    ).expect(422);
    await upload(
      uploadUrl(release.upload_url, { name: 'x.bin' }),
      'x',
      'application/octet-stream',
      reader.key,
    ).expect(403);

    const assets = await get(`${repo}/releases/${release.id}/assets`).expect(
      200,
    );
    expect(assets.body.map((asset: { name: string }) => asset.name)).toEqual([
      'data.json',
      'notes.txt',
    ]);
    expect(
      (
        await get(`${repo}/releases/${release.id}/assets?per_page=1`).expect(
          200,
        )
      ).headers.link,
    ).toContain('rel="next"');

    const bytes = await get(`${repo}/releases/assets/${json.body.id}`)
      .set('accept', 'application/octet-stream')
      .buffer(true)
      .parse((response, done) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(bytes.body.toString()).toBe('{"a":1}');
    expect(
      (await get(`${repo}/releases/assets/${json.body.id}`).expect(200)).body,
    ).toMatchObject({ name: 'data.json', download_count: 1 });

    const renamed = await send(
      'patch',
      `${repo}/releases/assets/${json.body.id}`,
      { name: 'data-v1.json', label: '' },
    ).expect(200);
    expect(renamed.body).toMatchObject({
      id: json.body.id,
      name: 'data-v1.json',
      label: null,
    });
    expect(
      (
        await send('patch', `${repo}/releases/assets/${json.body.id}`, {
          name: 'notes.txt',
        }).expect(422)
      ).body.errors,
    ).toEqual([
      { resource: 'ReleaseAsset', field: 'name', code: 'already_exists' },
    ]);

    await send('delete', `${repo}/releases/assets/${json.body.id}`).expect(204);
    await get(`${repo}/releases/assets/${json.body.id}`).expect(404);
    await get(`${repo}/releases/assets/nope`).expect(404);
  });

  it('edits a release, refusing to move it to another tag', async () => {
    const { body: release } = await get(`${repo}/releases/tags/v1.0`).expect(
      200,
    );
    const { body } = await send('patch', `${repo}/releases/${release.id}`, {
      tag_name: 'v1.0',
      name: 'First (edited)',
      body: null,
      prerelease: true,
    }).expect(200);
    expect(body).toMatchObject({
      name: 'First (edited)',
      body: null,
      prerelease: true,
    });
    // a prerelease is never the latest
    await get(`${repo}/releases/latest`).expect(404);
    expect(
      (
        await send('patch', `${repo}/releases/${release.id}`, {
          tag_name: 'v1.1',
        }).expect(422)
      ).body,
    ).toMatchObject({
      message: 'Ghost cannot move a release to another tag',
    });
    await send('patch', `${repo}/releases/${release.id}`, {
      discussion_category_name: 'Announcements',
    }).expect(404);
  });

  it('deletes a release, then its tag through git/refs, and refuses a missing ref', async () => {
    const { body: release } = await get(`${repo}/releases/tags/v1.0`).expect(
      200,
    );
    await send('delete', `${repo}/releases/${release.id}`).expect(204);
    await get(`${repo}/releases/${release.id}`).expect(404);

    await send('delete', `${repo}/git/refs/tags%2Fv1.0`).expect(204);
    expect(
      (await send('delete', `${repo}/git/refs/tags/v1.0`).expect(422)).body,
    ).toMatchObject({ message: 'Reference does not exist' });
    await send('delete', `${repo}/git/refs/heads/nope`).expect(422);
    await send('delete', `${repo}/git/refs/notes/x`).expect(422);
    await send('delete', `${repo}/git/refs/heads/feature`).expect(204);
    await send('delete', `${repo}/git/refs/tags/v2.0`, {}, reader.key).expect(
      403,
    );
  });
});
