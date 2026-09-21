import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDatabase, type Database, type Pool, schema } from '@ghost/db';
import { Test, type TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import * as openpgp from 'openpgp';

import { DATABASE } from '../../database/database.module.js';
import { UsersService } from '../users/users.service.js';
import { CommitVerificationService } from './commit-verification.service.js';

const CONNECTION = process.env.TEST_DATABASE_URL;
const MIGRATIONS = path.resolve(
  import.meta.dirname,
  '../../../../../packages/db/drizzle',
);

const USER_ID = 'user_gpg_spec';
const SIGNER_EMAIL = 'verify-spec@ghost.local';

/** A commit object signed the way git signs one: the armored signature goes in a `gpgsig` header whose continuation lines each carry a leading space, and everything else is what was signed. */
async function signCommit(
  message: string,
  signingKey: openpgp.PrivateKey,
): Promise<string> {
  const payload = [
    'tree 4b825dc642cb6eb9a060e54bf8d69288fbee4904',
    `author Spec <${SIGNER_EMAIL}> 1700000000 +0000`,
    `committer Spec <${SIGNER_EMAIL}> 1700000000 +0000`,
    '',
    `${message}\n`,
  ].join('\n');

  const signature = await openpgp.sign({
    message: await openpgp.createMessage({
      binary: new Uint8Array(Buffer.from(payload, 'utf8')),
    }),
    signingKeys: signingKey,
    detached: true,
    format: 'armored',
  });

  // `sign` types its result as a possible stream; armored output is a string.
  const header = (signature as string)
    .trimEnd()
    .split('\n')
    .map((line, index) => (index === 0 ? `gpgsig ${line}` : ` ${line}`))
    .join('\n');

  const [tree, author, committer, ...rest] = payload.split('\n');
  return [tree, author, committer, header, ...rest].join('\n');
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

  beforeAll(async () => {
    ({ db, pool } = createDatabase({ connectionString: CONNECTION }));
    await migrate(db, { migrationsFolder: MIGRATIONS });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CommitVerificationService,
        UsersService,
        { provide: DATABASE, useValue: db },
      ],
    }).compile();
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
});
