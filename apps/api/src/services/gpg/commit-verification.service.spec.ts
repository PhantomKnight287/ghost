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

    expect(verdict?.verified).toBe(true);
    expect(verdict?.keyId).toBe(keyId);
  });

  it('refuses a signature whose key is not linked to the author address', async () => {
    await addKey();

    // The signature is good; the address it is claimed for is someone else's.
    const verdict = (await verify('someone-else@example.com')).get(sha);

    expect(verdict?.verified).toBe(false);
    expect(verdict?.reason).toContain('someone-else@example.com');
  });

  it('refuses a key no account has uploaded', async () => {
    const verdict = (await verify(SIGNER_EMAIL)).get(sha);

    expect(verdict?.verified).toBe(false);
    expect(verdict?.reason).toContain('no Ghost account');
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

    expect(verdict?.verified).toBe(true);
    expect(verdict?.reason).toBe('Signed by Ghost');
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
    });
  });
});
