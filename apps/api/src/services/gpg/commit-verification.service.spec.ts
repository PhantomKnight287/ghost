import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { ConfigService } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import * as openpgp from 'openpgp';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { DATABASE } from '../../database/database.module.js';
import { insertSignature } from '../../lib/git/commits/commit-signature.js';
import { readPublicKey } from '../../lib/git/ssh/public-key.js';
import { GITHUB_MERGE_COMMIT_OBJECT } from '../../lib/gpg/__fixtures__/github-commits.js';
import { signPayload } from '../../lib/gpg/openpgp.js';
import { UsersService } from '../users/users.service.js';
import { CommitSigningService } from './commit-signing.service.js';
import { CommitVerificationService } from './commit-verification.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const USER_ID = 'user_gpg_spec';
const SIGNER_EMAIL = 'verify-spec@ghost.local';

/** A commit object signed the way git signs one, authored by `authorEmail`. */
async function signCommit(
  message: string,
  signingKey: openpgp.PrivateKey,
  authorEmail = SIGNER_EMAIL,
): Promise<string> {
  const payload = [
    'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    `author Spec <${authorEmail}> 1700000000 +0000`,
    `committer Spec <${authorEmail}> 1700000000 +0000`,
    '',
    `${message}\n`,
  ].join('\n');

  return insertSignature(
    payload,
    await signPayload({ payload, privateKey: signingKey }),
  );
}

// Needs a throwaway Postgres; the suite is skipped without one.
describe.skipIf(!CONNECTION)('CommitVerificationService', () => {
  let db: Database;
  let pool: Pool;
  let service: CommitVerificationService;
  let root: string;
  let gitDir: string;
  let sha: string;
  let keyId: string;
  let publicKey: string;
  let platformKey: openpgp.PrivateKey;
  let signingKey: openpgp.PrivateKey;

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });

    const platform = await openpgp.generateKey({
      userIDs: [{ name: 'Ghost', email: 'noreply@ghost.local' }],
      format: 'object',
    });
    platformKey = platform.privateKey;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommitVerificationService,
        CommitSigningService,
        UsersService,
        { provide: DATABASE, useValue: db },
        {
          provide: ConfigService,
          useValue: new ConfigService({
            COMMIT_SIGNING_KEY: Buffer.from(platformKey.armor()).toString(
              'base64',
            ),
          }),
        },
      ],
    }).compile();
    await module.init();
    service = module.get(CommitVerificationService);

    // Signed here so the suite needs no gpg on the machine; git's own header layout is covered by the fixture in commit-signature.spec.ts.
    const key = await openpgp.generateKey({
      userIDs: [{ name: 'Spec', email: SIGNER_EMAIL }],
      format: 'object',
    });
    signingKey = key.privateKey;
    keyId = key.publicKey.getKeyID().toHex().toLowerCase();
    publicKey = key.publicKey.armor();

    root = mkdtempSync(path.join(tmpdir(), 'ghost-verify-'));
    gitDir = path.join(root, '.git');
    execFileSync('git', ['init', '-q', '-b', 'main', root]);
    sha = execFileSync(
      'git',
      ['hash-object', '-t', 'commit', '-w', '--stdin'],
      {
        cwd: root,
        input: await signCommit('signed commit', key.privateKey),
        encoding: 'utf8',
      },
    ).trim();
  });

  afterAll(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, USER_ID));
    await pool.end();
    rmSync(root, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await db.delete(schema.user).where(eq(schema.user.id, USER_ID));
    await db.insert(schema.user).values({
      id: USER_ID,
      name: 'Spec',
      email: SIGNER_EMAIL,
      emailVerified: true,
    });
  });

  async function addKey() {
    await db.insert(schema.userGpgKey).values({
      id: 'gpg_spec',
      userId: USER_ID,
      keyId,
      fingerprint: keyId.repeat(2),
      publicKey,
    });
  }

  function verify(authorEmail: string) {
    return service.verifyCommits({
      gitDir,
      commits: [{ sha, authorEmail }],
    });
  }

  it('verifies a commit signed by a key its author uploaded', async () => {
    await addKey();

    const verdict = (await verify(SIGNER_EMAIL)).get(sha);

    expect(verdict).toEqual({
      verified: true,
      reason: 'Signed and verified',
      keyId,
      state: 'valid',
      signerId: USER_ID,
    });
  });

  it('refuses a signature whose key is not linked to the author address', async () => {
    await addKey();

    // The signature is good; the address it is claimed for is someone else's.
    const verdict = (await verify('someone-else@example.com')).get(sha);

    expect(verdict).toEqual({
      verified: false,
      reason: 'The signing key is not linked to someone-else@example.com',
      keyId,
      state: 'bad_email',
      signerId: null,
    });
  });

  it('refuses a key no account has uploaded', async () => {
    const verdict = (await verify(SIGNER_EMAIL)).get(sha);

    expect(verdict).toEqual({
      verified: false,
      reason: 'Signed with a key no Ghost account has uploaded',
      keyId,
      state: 'unknown_key',
      signerId: null,
    });
  });

  it('leaves unsigned commits out of the result', async () => {
    await addKey();
    const unsigned = execFileSync(
      'git',
      [
        'commit-tree',
        '4b825dc642cb6eb9a060e54bf8d69288fbee4904',
        '-m',
        'plain',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: {
          ...process.env,
          GIT_DIR: gitDir,
          GIT_AUTHOR_NAME: 'Spec',
          GIT_AUTHOR_EMAIL: SIGNER_EMAIL,
          GIT_COMMITTER_NAME: 'Spec',
          GIT_COMMITTER_EMAIL: SIGNER_EMAIL,
        },
      },
    ).trim();

    const verdicts = await service.verifyCommits({
      gitDir,
      commits: [
        { sha, authorEmail: SIGNER_EMAIL },
        { sha: unsigned, authorEmail: SIGNER_EMAIL },
      ],
    });

    expect([...verdicts.keys()]).toEqual([sha]);
  });

  function writeCommit(object: string) {
    return execFileSync(
      'git',
      ['hash-object', '-t', 'commit', '-w', '--stdin'],
      {
        cwd: root,
        input: object,
        encoding: 'utf8',
      },
    ).trim();
  }

  it("verifies GitHub's own merge commits whoever authored them", async () => {
    const merge = writeCommit(GITHUB_MERGE_COMMIT_OBJECT);

    const verdict = (
      await service.verifyCommits({
        gitDir,
        commits: [{ sha: merge, authorEmail: 'not-on-ghost@example.com' }],
      })
    ).get(merge);

    expect(verdict).toEqual({
      verified: true,
      reason: 'Signed by GitHub',
      keyId: 'b5690eeebb952194',
      state: 'valid',
      signerId: null,
    });
  });

  it('verifies commits Ghost signed with its own key', async () => {
    const merge = writeCommit(
      await signCommit('merged by ghost', platformKey, 'merger@example.com'),
    );

    const verdict = (
      await service.verifyCommits({
        gitDir,
        commits: [{ sha: merge, authorEmail: 'merger@example.com' }],
      })
    ).get(merge);

    expect(verdict).toMatchObject({
      verified: true,
      reason: 'Signed by Ghost',
      state: 'valid',
      signerId: null,
    });
  });

  it("refuses a commit that names GitHub's key but was not signed by it", async () => {
    const forged = GITHUB_MERGE_COMMIT_OBJECT.replace(
      'Verify a push before the log commits it',
      'Something GitHub never signed',
    );
    const sha = writeCommit(forged);

    const verdict = (
      await service.verifyCommits({
        gitDir,
        commits: [{ sha, authorEmail: SIGNER_EMAIL }],
      })
    ).get(sha);

    expect(verdict?.verified).toBe(false);
    expect(verdict?.reason).toBe('Signature does not match the commit');
    expect(verdict?.state).toBe('invalid');
  });

  it('refuses a known key whose signature does not match the commit', async () => {
    await addKey();
    const tampered = (
      await signCommit('signed then edited', signingKey)
    ).replace('signed then edited', 'edited after signing');

    const verdict = (
      await service.verifyCommits({
        gitDir,
        commits: [{ sha: writeCommit(tampered), authorEmail: SIGNER_EMAIL }],
      })
    )
      .values()
      .next().value;

    expect(verdict).toEqual({
      verified: false,
      reason: 'Signature does not match the commit',
      keyId,
      state: 'invalid',
      signerId: null,
    });
  });

  describe('tags', () => {
    /** A tag object tagged by `taggerEmail`, signed the way `git tag -s` signs one: the armored signature appended after the message. */
    function tagPayload(
      name: string,
      taggerEmail: string | null = SIGNER_EMAIL,
    ) {
      const tagger =
        taggerEmail === null
          ? ''
          : `tagger Spec <${taggerEmail}> 1700000000 +0000\n`;
      return `object ${sha}\ntype commit\ntag ${name}\n${tagger}\n${name} release\n`;
    }

    async function signTag(payload: string, key = signingKey) {
      return `${payload}${await signPayload({ payload, privateKey: key })}`;
    }

    function writeTag(object: string) {
      return execFileSync(
        'git',
        ['hash-object', '-t', 'tag', '-w', '--stdin', '--literally'],
        { cwd: root, input: object, encoding: 'utf8' },
      ).trim();
    }

    async function verifyTag(tagSha: string, taggerEmail: string) {
      return (
        await service.verifyCommits({
          gitDir,
          commits: [{ sha: tagSha, authorEmail: taggerEmail }],
        })
      ).get(tagSha);
    }

    it('verifies a GPG-signed tag whose tagger owns the key', async () => {
      await addKey();
      const tag = writeTag(await signTag(tagPayload('v-gpg')));

      expect(await verifyTag(tag, SIGNER_EMAIL)).toEqual({
        verified: true,
        reason: 'Signed and verified',
        keyId,
        state: 'valid',
        signerId: USER_ID,
      });
    });

    it('refuses a tag signed with a key no account has uploaded', async () => {
      const tag = writeTag(await signTag(tagPayload('v-unknown')));

      expect(await verifyTag(tag, SIGNER_EMAIL)).toEqual({
        verified: false,
        reason: 'Signed with a key no Ghost account has uploaded',
        keyId,
        state: 'unknown_key',
        signerId: null,
      });
    });

    it('refuses a tag whose tagger email the key owner has not verified', async () => {
      await addKey();
      const tagger = 'someone-else@example.com';
      const tag = writeTag(await signTag(tagPayload('v-bad-email', tagger)));

      expect(await verifyTag(tag, tagger)).toEqual({
        verified: false,
        reason: `The signing key is not linked to ${tagger}`,
        keyId,
        state: 'bad_email',
        signerId: null,
      });
    });

    it('refuses a tag edited after signing, naming the tag', async () => {
      await addKey();
      const tampered = (await signTag(tagPayload('v-tampered'))).replace(
        'v-tampered release',
        'v-tampered rewritten',
      );
      const tag = writeTag(tampered);

      expect(await verifyTag(tag, SIGNER_EMAIL)).toEqual({
        verified: false,
        reason: 'Signature does not match the tag',
        keyId,
        state: 'invalid',
        signerId: null,
      });
    });

    it('verifies a tag Ghost signed with its own key whoever tagged it', async () => {
      const tagger = 'releaser@example.com';
      const tag = writeTag(
        await signTag(tagPayload('v-ghost', tagger), platformKey),
      );

      expect(await verifyTag(tag, tagger)).toMatchObject({
        verified: true,
        reason: 'Signed by Ghost',
        state: 'valid',
        signerId: null,
      });
    });

    it('refuses a user-signed tag with no tagger, and still verifies a Ghost-signed one', async () => {
      await addKey();
      const userSigned = writeTag(
        await signTag(tagPayload('v-no-tagger', null)),
      );
      const ghostSigned = writeTag(
        await signTag(tagPayload('v-no-tagger-ghost', null), platformKey),
      );

      expect(await verifyTag(userSigned, '')).toMatchObject({
        verified: false,
        state: 'bad_email',
        signerId: null,
      });
      expect(await verifyTag(ghostSigned, '')).toMatchObject({
        verified: true,
        reason: 'Signed by Ghost',
      });
    });

    it('leaves unsigned tags out of the result', async () => {
      const tag = writeTag(tagPayload('v-unsigned'));

      expect(await verifyTag(tag, SIGNER_EMAIL)).toBeUndefined();
    });
  });

  describe('SSH signatures', () => {
    let sshKeyPath: string;
    let sshPublicKey: string;
    const OTHER_USER = 'user_ssh_other_spec';

    /** Signs like `git commit -S` with `gpg.format=ssh`: ssh-keygen over the unsigned object, namespace git. */
    function sshSignCommit(
      message: string,
      authorEmail = SIGNER_EMAIL,
      namespace = 'git',
    ) {
      const payload = [
        'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
        `author Spec <${authorEmail}> 1700000000 +0000`,
        `committer Spec <${authorEmail}> 1700000000 +0000`,
        '',
        `${message}\n`,
      ].join('\n');
      const file = path.join(root, `payload-${message.replaceAll(' ', '-')}`);
      writeFileSync(file, payload);
      execFileSync(
        'ssh-keygen',
        ['-Y', 'sign', '-n', namespace, '-f', sshKeyPath, file],
        {
          stdio: 'ignore',
        },
      );
      return writeCommit(
        insertSignature(payload, readFileSync(`${file}.sig`, 'utf8')),
      );
    }

    async function addSigningKey(userId = USER_ID) {
      const key = readPublicKey(sshPublicKey);
      await db.insert(schema.userSshSigningKey).values({
        id: `sshsig_${userId}`,
        userId,
        title: 'laptop',
        fingerprint: key.fingerprint,
        publicKey: key.blob,
      });
    }

    beforeAll(() => {
      sshKeyPath = path.join(root, 'id_ed25519');
      execFileSync('ssh-keygen', [
        '-q',
        '-t',
        'ed25519',
        '-N',
        '',
        '-f',
        sshKeyPath,
      ]);
      sshPublicKey = readFileSync(`${sshKeyPath}.pub`, 'utf8');
    });

    beforeEach(async () => {
      await db.delete(schema.user).where(eq(schema.user.id, OTHER_USER));
    });

    afterAll(async () => {
      await db.delete(schema.user).where(eq(schema.user.id, OTHER_USER));
    });

    async function verdictFor(commit: string, authorEmail = SIGNER_EMAIL) {
      return (
        await service.verifyCommits({
          gitDir,
          commits: [{ sha: commit, authorEmail }],
        })
      ).get(commit);
    }

    it("verifies a commit signed with the author's signing key", async () => {
      await addSigningKey();
      const verdict = await verdictFor(sshSignCommit('ssh signed'));
      expect(verdict).toEqual({
        verified: true,
        reason: 'Signed and verified',
        keyId: `SHA256:${readPublicKey(sshPublicKey).fingerprint}`,
        state: 'valid',
        signerId: USER_ID,
      });
    });

    /** Signs a tag like `git tag -s` with `gpg.format=ssh`: ssh-keygen over the unsigned tag, namespace git, the signature appended after the message. */
    function sshSignTag(name: string, taggerEmail = SIGNER_EMAIL) {
      const payload = `object ${sha}\ntype commit\ntag ${name}\ntagger Spec <${taggerEmail}> 1700000000 +0000\n\n${name} release\n`;
      const file = path.join(root, `tag-payload-${name}`);
      writeFileSync(file, payload);
      execFileSync(
        'ssh-keygen',
        ['-Y', 'sign', '-n', 'git', '-f', sshKeyPath, file],
        { stdio: 'ignore' },
      );
      return execFileSync(
        'git',
        ['hash-object', '-t', 'tag', '-w', '--stdin'],
        {
          cwd: root,
          input: `${payload}${readFileSync(`${file}.sig`, 'utf8')}`,
          encoding: 'utf8',
        },
      ).trim();
    }

    it("verifies an SSH-signed tag with the tagger's signing key", async () => {
      await addSigningKey();
      const verdict = await verdictFor(sshSignTag('v-ssh'));
      expect(verdict).toEqual({
        verified: true,
        reason: 'Signed and verified',
        keyId: `SHA256:${readPublicKey(sshPublicKey).fingerprint}`,
        state: 'valid',
        signerId: USER_ID,
      });
    });

    it('refuses an SSH-signed tag whose key no account has uploaded', async () => {
      const verdict = await verdictFor(sshSignTag('v-ssh-unknown'));
      expect(verdict).toMatchObject({
        verified: false,
        reason: 'Signed with a key no Ghost account has uploaded',
        state: 'unknown_key',
        signerId: null,
      });
    });

    it('refuses an SSH-signed tag whose tagger email the key owner has not verified', async () => {
      await addSigningKey();
      const tagger = 'not-mine-ssh@example.com';
      const verdict = await verdictFor(
        sshSignTag('v-ssh-email', tagger),
        tagger,
      );
      expect(verdict).toMatchObject({
        verified: false,
        reason: `The signing key is not linked to ${tagger}`,
        state: 'bad_email',
        signerId: null,
      });
    });

    it('refuses a key no account has uploaded as a signing key', async () => {
      const verdict = await verdictFor(sshSignCommit('ssh unknown'));
      expect(verdict?.verified).toBe(false);
      expect(verdict?.reason).toContain('no Ghost account');
    });

    it('does not accept an authentication key as a signing key', async () => {
      const key = readPublicKey(sshPublicKey);
      await db.insert(schema.userSshKey).values({
        id: 'ssh_auth_spec',
        userId: USER_ID,
        title: 'auth only',
        fingerprint: key.fingerprint,
        publicKey: key.blob,
      });
      const verdict = await verdictFor(sshSignCommit('ssh auth key'));
      expect(verdict?.verified).toBe(false);
      expect(verdict?.reason).toContain('no Ghost account');
    });

    it('refuses a key that belongs to someone other than the author', async () => {
      await db.insert(schema.user).values({
        id: OTHER_USER,
        name: 'Other',
        email: 'other-ssh@ghost.local',
        emailVerified: true,
      });
      await addSigningKey(OTHER_USER);
      const verdict = await verdictFor(sshSignCommit('ssh other owner'));
      expect(verdict?.verified).toBe(false);
      expect(verdict?.reason).toContain(SIGNER_EMAIL);
    });

    it('refuses an author address the key owner has not verified', async () => {
      const unverified = 'secondary-ssh@ghost.local';
      await db.insert(schema.userEmail).values({
        id: 'email_ssh_spec',
        userId: USER_ID,
        email: unverified,
        verified: false,
      });
      await addSigningKey();
      const verdict = await verdictFor(
        sshSignCommit('ssh unverified email', unverified),
        unverified,
      );
      expect(verdict?.verified).toBe(false);
      expect(verdict?.reason).toContain(unverified);
    });

    it('refuses a signature made for another namespace', async () => {
      await addSigningKey();
      const verdict = await verdictFor(
        sshSignCommit('ssh file namespace', SIGNER_EMAIL, 'file'),
      );
      expect(verdict?.verified).toBe(false);
      expect(verdict?.reason).toBe('Signature does not match the commit');
      expect(verdict?.state).toBe('invalid');
    });
  });
});
