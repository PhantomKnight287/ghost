import type { INestApplication } from '@nestjs/common';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import * as openpgp from 'openpgp';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { insertSignature } from '../src/lib/git/commits/commit-signature.js';
import { signPayload } from '../src/lib/gpg/openpgp.js';
import { hasBackends, signUp, startApp } from './harness.js';

// 1700000000 seconds, as GitHub writes a git date.
const TAGGED_AT = '2023-11-14T22:13:20Z';

describe.skipIf(!hasBackends)('Signed tags', () => {
  let app: INestApplication;
  let origin: string;
  let work: string;
  let owner: { cookie: string; key: string; userId: string };
  let stranger: { cookie: string; key: string; userId: string };
  const username = `sigtags${Date.now()}`;
  const email = `${username}@example.com`;
  const repo = `${username}/tagged`;

  let ownerKey: openpgp.PrivateKey;
  let ownerKeyId: string;
  let platformKey: openpgp.PrivateKey;
  let sshKeyPath: string;
  let sshFingerprint: string;

  let base: string;
  /** Tag name to the sha of its tag object; lightweight tags are absent. */
  const tagObjects = new Map<string, string>();
  /** Tag name to the payload its signature covers. */
  const tagPayloads = new Map<string, string>();
  /** Branch name to its tip. */
  const tips = new Map<string, string>();

  const http = () => request(app.getHttpServer());
  const ghost = (route: string, cookie = owner.cookie) =>
    http().get(`/api/repositories/${repo}${route}`).set('cookie', cookie);
  const v3 = (route: string, key = owner.key) =>
    http()
      .get(`/api/v3/repos/${repo}${route}`)
      .set('authorization', `token ${key}`);
  const graphql = async (query: string, variables: object = {}) => {
    const { body } = await http()
      .post('/api/graphql')
      .set('authorization', `token ${owner.key}`)
      .send({ query, variables })
      .expect(200);
    expect(body.errors).toBeUndefined();
    return body.data;
  };

  const git = (...args: string[]) =>
    execFileSync(
      'git',
      ['-c', `user.name=Owner`, '-c', `user.email=${email}`, ...args],
      { cwd: work, encoding: 'utf8' },
    ).trim();

  const write = (type: 'tag' | 'commit', object: string) =>
    execFileSync('git', ['hash-object', '-t', type, '-w', '--stdin'], {
      cwd: work,
      input: object,
      encoding: 'utf8',
    }).trim();

  const sshSign = (payload: string, name: string) => {
    const file = path.join(work, '.git', `payload-${name}`);
    writeFileSync(file, payload);
    execFileSync(
      'ssh-keygen',
      ['-Y', 'sign', '-n', 'git', '-f', sshKeyPath, file],
      {
        stdio: 'ignore',
      },
    );
    return readFileSync(`${file}.sig`, 'utf8');
  };

  /** Writes an annotated tag on `base` the way `git tag -s` does, the signature appended after the message, and points `refs/tags/<name>` at it. */
  const tag = async (
    name: string,
    sign: ((payload: string) => Promise<string> | string) | null,
    taggerEmail = email,
  ) => {
    const payload = `object ${base}\ntype commit\ntag ${name}\ntagger Owner <${taggerEmail}> 1700000000 +0000\n\n${name} release\n`;
    const oid = write(
      'tag',
      sign ? `${payload}${await sign(payload)}` : payload,
    );
    git('update-ref', `refs/tags/${name}`, oid);
    tagObjects.set(name, oid);
    tagPayloads.set(name, payload);
  };

  /** Writes a commit on `base` signed by `sign`, authored by `authorEmail`, as branch `name`. */
  const commit = async (
    name: string,
    sign: ((payload: string) => Promise<string> | string) | null,
    authorEmail = email,
  ) => {
    const tree = git('rev-parse', `${base}^{tree}`);
    const payload = `tree ${tree}\nparent ${base}\nauthor Owner <${authorEmail}> 1700000000 +0000\ncommitter Owner <${authorEmail}> 1700000000 +0000\n\n${name}\n`;
    const sha = write(
      'commit',
      sign ? insertSignature(payload, await sign(payload)) : payload,
    );
    git('update-ref', `refs/heads/${name}`, sha);
    tips.set(name, sha);
  };

  const push = async (target: string) => {
    // The server runs in this process, so the push must not block the event loop.
    await promisify(execFile)(
      'git',
      [
        'push',
        '-q',
        `${origin.replace('://', `://${username}:${owner.key}@`)}/${target}.git`,
        'refs/heads/*:refs/heads/*',
        'refs/tags/*:refs/tags/*',
      ],
      { cwd: work, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
    );
  };

  beforeAll(async () => {
    const platform = await openpgp.generateKey({
      userIDs: [{ name: 'Ghost', email: 'noreply@ghost.local' }],
      format: 'object',
    });
    platformKey = platform.privateKey;
    ({ app, origin } = await startApp({
      COMMIT_SIGNING_KEY: Buffer.from(platformKey.armor()).toString('base64'),
    }));
    owner = await signUp(app, username);
    stranger = await signUp(app, `${username}x`);

    const generated = await openpgp.generateKey({
      userIDs: [{ name: 'Owner', email }],
      format: 'object',
    });
    ownerKey = generated.privateKey;
    ownerKeyId = generated.publicKey.getKeyID().toHex().toLowerCase();
    await http()
      .post('/api/gpg-keys')
      .set('cookie', owner.cookie)
      .send({ publicKey: generated.publicKey.armor() })
      .expect(201);
    const stray = (
      await openpgp.generateKey({
        userIDs: [{ name: 'Nobody', email }],
        format: 'object',
      })
    ).privateKey;

    work = mkdtempSync(path.join(tmpdir(), 'ghost-e2e-sigtags-'));
    git('init', '-q', '-b', 'main');
    sshKeyPath = path.join(work, '.git', 'id_signing');
    execFileSync('ssh-keygen', [
      '-q',
      '-t',
      'ed25519',
      '-N',
      '',
      '-f',
      sshKeyPath,
    ]);
    const added = await http()
      .post('/api/ssh-signing-keys')
      .set('cookie', owner.cookie)
      .send({ publicKey: readFileSync(`${sshKeyPath}.pub`, 'utf8') })
      .expect(201);
    sshFingerprint = added.body.fingerprint;

    writeFileSync(path.join(work, 'a.txt'), 'one\n');
    git('add', '.');
    git('commit', '-q', '--no-gpg-sign', '-m', 'first');
    base = git('rev-parse', 'HEAD');

    const byOwner = (payload: string) =>
      signPayload({ payload, privateKey: ownerKey });
    await tag('gpg-signed', byOwner);
    await tag('ssh-signed', (payload) => sshSign(payload, 'ssh-signed'));
    await tag('unknown-key', (payload) =>
      signPayload({ payload, privateKey: stray }),
    );
    await tag('wrong-tagger', byOwner, 'someone-else@example.com');
    await tag('unsigned', null);
    git('tag', 'light', base);
    // A branch and a tag of the same name, for short-name lookups.
    git('branch', 'both', base);
    git('tag', 'both', base);

    await commit('signed-gpg', byOwner);
    await commit('signed-ssh', (payload) => sshSign(payload, 'signed-ssh'));
    await commit('unknown', (payload) =>
      signPayload({ payload, privateKey: stray }),
    );
    await commit('bad-email', byOwner, 'someone-else@example.com');
    await commit('ghost-signed', (payload) =>
      signPayload({ payload, privateKey: platformKey }),
    );
    await commit('plain', null);

    for (const name of ['tagged', 'hidden']) {
      await http()
        .post('/api/repositories')
        .set('cookie', owner.cookie)
        .send({ name, visibility: name === 'hidden' ? 'private' : 'public' })
        .expect(201);
      await push(`${username}/${name}`);
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    if (work) rmSync(work, { recursive: true, force: true });
  });

  describe('Ghost API', () => {
    it('carries each annotated tag’s verdict in the tags list, null for lightweight and unsigned tags', async () => {
      const { body } = await ghost('/tags?limit=100').expect(200);
      const verdict = (name: string) =>
        body.tags.find((tag: { name: string }) => tag.name === name)
          ?.verification;

      expect(verdict('gpg-signed')).toMatchObject({
        verified: true,
        reason: 'Signed and verified',
        keyId: ownerKeyId,
      });
      expect(verdict('ssh-signed')).toMatchObject({
        verified: true,
        reason: 'Signed and verified',
        keyId: `SHA256:${sshFingerprint}`,
      });
      expect(verdict('unknown-key')).toMatchObject({
        verified: false,
        reason: 'Signed with a key no Ghost account has uploaded',
      });
      expect(verdict('wrong-tagger')).toMatchObject({
        verified: false,
        reason: 'The signing key is not linked to someone-else@example.com',
      });
      expect(verdict('unsigned')).toBeNull();
      expect(verdict('light')).toBeNull();
    });

    it('signs the tag of a new release with Ghost’s key and reports it on the release', async () => {
      const created = await http()
        .post(`/api/repositories/${repo}/releases`)
        .set('cookie', owner.cookie)
        .send({ tagName: 'v-release', target: 'main', name: 'Release' })
        .expect(201);
      expect(created.body.tagVerification).toMatchObject({
        verified: true,
        reason: 'Signed by Ghost',
      });

      const fetched = await ghost('/releases/tags/v-release').expect(200);
      expect(fetched.body.tagVerification).toEqual(
        created.body.tagVerification,
      );

      const listed = await ghost('/releases').expect(200);
      expect(
        listed.body.releases.find(
          (release: { tagName: string }) => release.tagName === 'v-release',
        )?.tagVerification,
      ).toEqual(created.body.tagVerification);

      const tags = await ghost('/tags?limit=100').expect(200);
      expect(
        tags.body.tags.find((tag: { name: string }) => tag.name === 'v-release')
          ?.verification,
      ).toMatchObject({ verified: true, reason: 'Signed by Ghost' });
    });

    it('reports the verdict of an existing tag a release is made on, and null for a lightweight one', async () => {
      const signed = await http()
        .post(`/api/repositories/${repo}/releases`)
        .set('cookie', owner.cookie)
        .send({ tagName: 'gpg-signed' })
        .expect(201);
      expect(signed.body.tagVerification).toMatchObject({
        verified: true,
        reason: 'Signed and verified',
        keyId: ownerKeyId,
      });

      const light = await http()
        .post(`/api/repositories/${repo}/releases`)
        .set('cookie', owner.cookie)
        .send({ tagName: 'light' })
        .expect(201);
      expect(light.body.tagVerification).toBeNull();
    });
  });

  describe('GitHub REST: GET git/tags/{tag_sha}', () => {
    it('answers a signed tag in GitHub’s shape', async () => {
      const sha = tagObjects.get('gpg-signed')!;
      const { body } = await v3(`/git/tags/${sha}`).expect(200);

      expect(body).toEqual({
        node_id: expect.any(String),
        tag: 'gpg-signed',
        sha,
        url: expect.stringMatching(
          new RegExp(`/api/v3/repos/${repo}/git/tags/${sha}$`),
        ),
        message: 'gpg-signed release\n',
        tagger: { name: 'Owner', email, date: TAGGED_AT },
        object: {
          type: 'commit',
          sha: base,
          url: expect.stringMatching(
            new RegExp(`/api/v3/repos/${repo}/git/commits/${base}$`),
          ),
        },
        verification: {
          verified: true,
          reason: 'valid',
          signature: expect.stringMatching(
            /^-----BEGIN PGP SIGNATURE-----\n[\s\S]*-----END PGP SIGNATURE-----\n?$/,
          ),
          payload: tagPayloads.get('gpg-signed'),
          verified_at: null,
        },
      });
    });

    it('verifies an SSH-signed tag', async () => {
      const { body } = await v3(
        `/git/tags/${tagObjects.get('ssh-signed')}`,
      ).expect(200);

      expect(body.verification).toEqual({
        verified: true,
        reason: 'valid',
        signature: expect.stringMatching(/^-----BEGIN SSH SIGNATURE-----/),
        payload: tagPayloads.get('ssh-signed'),
        verified_at: null,
      });
    });

    it('gives GitHub’s reason for each refusal', async () => {
      const reason = async (name: string) =>
        (await v3(`/git/tags/${tagObjects.get(name)}`).expect(200)).body
          .verification;

      expect(await reason('unknown-key')).toMatchObject({
        verified: false,
        reason: 'unknown_key',
        signature: expect.any(String),
        payload: tagPayloads.get('unknown-key'),
      });
      expect(await reason('wrong-tagger')).toMatchObject({
        verified: false,
        reason: 'bad_email',
      });
      expect(await reason('unsigned')).toEqual({
        verified: false,
        reason: 'unsigned',
        signature: null,
        payload: null,
        verified_at: null,
      });
    });

    it('answers 404 for a commit sha and a sha that is not there', async () => {
      const commit = await v3(`/git/tags/${base}`).expect(404);
      expect(commit.body.message).toBe('Not Found');
      await v3(`/git/tags/${'f'.repeat(40)}`).expect(404);
    });

    it('hides a private repository’s tags from someone who cannot read it', async () => {
      const sha = tagObjects.get('gpg-signed')!;
      await http()
        .get(`/api/v3/repos/${username}/hidden/git/tags/${sha}`)
        .set('authorization', `token ${owner.key}`)
        .expect(200);
      await http()
        .get(`/api/v3/repos/${username}/hidden/git/tags/${sha}`)
        .set('authorization', `token ${stranger.key}`)
        .expect(404);
    });
  });

  describe('GitHub GraphQL', () => {
    const TARGET = `
      target {
        __typename
        ... on Tag {
          id name oid abbreviatedOid message commitUrl commitResourcePath
          tagger { name email }
          target { __typename ... on Commit { oid } }
        }
        ... on Commit { oid }
      }`;

    it('resolves an annotated tag through Repository.ref', async () => {
      const data = await graphql(
        `query($owner: String!) { repository(owner: $owner, name: "tagged") { ref(qualifiedName: "refs/tags/gpg-signed") { name prefix ${TARGET} } } }`,
        { owner: username },
      );
      const sha = tagObjects.get('gpg-signed')!;

      expect(data.repository.ref).toEqual({
        name: 'gpg-signed',
        prefix: 'refs/tags/',
        target: {
          __typename: 'Tag',
          id: expect.any(String),
          name: 'gpg-signed',
          oid: sha,
          abbreviatedOid: sha.slice(0, 7),
          message: 'gpg-signed release\n',
          commitUrl: expect.stringMatching(
            new RegExp(`/${repo}/commit/${base}$`),
          ),
          commitResourcePath: `/${repo}/commit/${base}`,
          tagger: { name: 'Owner', email },
          target: { __typename: 'Commit', oid: base },
        },
      });
    });

    it('resolves a lightweight tag to its commit, prefers a branch for a short name, and is null for a missing ref', async () => {
      const data = await graphql(
        `query($owner: String!) { repository(owner: $owner, name: "tagged") {
          light: ref(qualifiedName: "refs/tags/light") { ${TARGET} }
          both: ref(qualifiedName: "both") { prefix }
          short: ref(qualifiedName: "gpg-signed") { prefix }
          missing: ref(qualifiedName: "refs/tags/nope") { name }
        } }`,
        { owner: username },
      );

      expect(data.repository.light.target).toEqual({
        __typename: 'Commit',
        oid: base,
      });
      expect(data.repository.both.prefix).toBe('refs/heads/');
      expect(data.repository.short.prefix).toBe('refs/tags/');
      expect(data.repository.missing).toBeNull();
    });

    it('pages tags through Repository.refs, alphabetically by default', async () => {
      const page = (after: string | null) =>
        graphql(
          `query($owner: String!, $after: String) { repository(owner: $owner, name: "tagged") {
            refs(refPrefix: "refs/tags/", first: 3, after: $after) {
              totalCount
              pageInfo { hasNextPage endCursor }
              nodes { name prefix }
            }
          } }`,
          { owner: username, after },
        );

      const names: string[] = [];
      let after: string | null = null;
      let total = 0;
      do {
        const refs: {
          totalCount: number;
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: { name: string; prefix: string }[];
        } = (await page(after)).repository.refs;
        total = refs.totalCount;
        for (const node of refs.nodes) {
          expect(node.prefix).toBe('refs/tags/');
          names.push(node.name);
        }
        after = refs.pageInfo.hasNextPage ? refs.pageInfo.endCursor : null;
      } while (after);

      expect(names.length).toBe(total);
      expect(names).toEqual([...names].sort());
      expect(names).toEqual(
        expect.arrayContaining([
          'both',
          'gpg-signed',
          'light',
          'ssh-signed',
          'unknown-key',
          'unsigned',
          'wrong-tagger',
        ]),
      );
    });

    it('filters refs by name and refuses a prefix other than heads or tags', async () => {
      const data = await graphql(
        `query($owner: String!) { repository(owner: $owner, name: "tagged") {
          signed: refs(refPrefix: "refs/tags/", first: 10, query: "-signed") { nodes { name } }
          branches: refs(refPrefix: "refs/heads/", first: 10, orderBy: { field: ALPHABETICAL, direction: DESC }) { nodes { name } }
          other: refs(refPrefix: "refs/pull/", first: 10) { nodes { name } }
        } }`,
        { owner: username },
      );

      expect(
        data.repository.signed.nodes.map((node: { name: string }) => node.name),
      ).toEqual(['gpg-signed', 'ssh-signed']);
      const branches = data.repository.branches.nodes.map(
        (node: { name: string }) => node.name,
      );
      expect(branches).toEqual([...branches].sort().reverse());
      expect(branches).toContain('main');
      expect(data.repository.other).toBeNull();
    });

    it('orders tags by the date of their commit', async () => {
      const data = await graphql(
        `query($owner: String!) { repository(owner: $owner, name: "tagged") {
          refs(refPrefix: "refs/tags/", first: 100, orderBy: { field: TAG_COMMIT_DATE, direction: DESC }) { nodes { name } }
        } }`,
        { owner: username },
      );

      expect(data.repository.refs.nodes.length).toBeGreaterThan(0);
    });

    it('resolves Release.tag and Release.tagCommit', async () => {
      await http()
        .post(`/api/repositories/${repo}/releases`)
        .set('cookie', owner.cookie)
        .send({ tagName: 'unsigned' })
        .expect(201);

      const data = await graphql(
        `query($owner: String!) { repository(owner: $owner, name: "tagged") {
          release(tagName: "unsigned") { tag { name prefix ${TARGET} } tagCommit { oid } }
        } }`,
        { owner: username },
      );

      expect(data.repository.release).toMatchObject({
        tag: {
          name: 'unsigned',
          prefix: 'refs/tags/',
          target: { __typename: 'Tag', oid: tagObjects.get('unsigned') },
        },
        tagCommit: { oid: base },
      });
    });

    describe('Commit.signature', () => {
      const signatureOf = async (branch: string) =>
        (
          await graphql(
            `query($owner: String!, $ref: String!) { repository(owner: $owner, name: "tagged") {
              ref(qualifiedName: $ref) { target { ... on Commit {
                oid commitUrl commitResourcePath repository { name }
                signature {
                  __typename isValid state email wasSignedByGitHub payload signature verifiedAt
                  signer { login }
                  ... on GpgSignature { keyId }
                  ... on SshSignature { keyFingerprint }
                }
              } } }
            } }`,
            { owner: username, ref: `refs/heads/${branch}` },
          )
        ).repository.ref.target;

      it('reads a verified GPG signature', async () => {
        const target = await signatureOf('signed-gpg');

        expect(target).toMatchObject({
          oid: tips.get('signed-gpg'),
          commitResourcePath: `/${repo}/commit/${tips.get('signed-gpg')}`,
          repository: { name: 'tagged' },
        });
        expect(target.signature).toEqual({
          __typename: 'GpgSignature',
          isValid: true,
          state: 'VALID',
          email,
          wasSignedByGitHub: false,
          payload: expect.stringContaining('\n\nsigned-gpg\n'),
          signature: expect.stringMatching(/^-----BEGIN PGP SIGNATURE-----/),
          verifiedAt: null,
          signer: { login: username },
          keyId: ownerKeyId,
        });
      });

      it('reads a verified SSH signature', async () => {
        expect((await signatureOf('signed-ssh')).signature).toMatchObject({
          __typename: 'SshSignature',
          isValid: true,
          state: 'VALID',
          signer: { login: username },
          keyFingerprint: `SHA256:${sshFingerprint}`,
        });
      });

      it('names the reason a signature does not verify, and no signer', async () => {
        expect((await signatureOf('unknown')).signature).toMatchObject({
          isValid: false,
          state: 'UNKNOWN_KEY',
          signer: null,
        });
        expect((await signatureOf('bad-email')).signature).toMatchObject({
          isValid: false,
          state: 'BAD_EMAIL',
          email: 'someone-else@example.com',
          signer: null,
        });
      });

      it('marks a commit Ghost signed as signed by the platform', async () => {
        expect((await signatureOf('ghost-signed')).signature).toMatchObject({
          isValid: true,
          state: 'VALID',
          wasSignedByGitHub: true,
          signer: null,
        });
      });

      it('is null for an unsigned commit', async () => {
        expect((await signatureOf('plain')).signature).toBeNull();
      });
    });
  });
});
