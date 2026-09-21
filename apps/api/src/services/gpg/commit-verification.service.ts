import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { readSignedCommits } from '../git/commits/commit-signature.js';
import { signingKeyIds, verifySignature } from './openpgp.js';

export interface CommitVerification {
  verified: boolean;
  /** Why the badge says what it says, short enough for a tooltip. */
  reason: string;
  /** Long key id the signature names, lowercase hex. */
  keyId: string;
}

/** Commit identity a verification is judged against. */
export interface VerifiableCommit {
  sha: string;
  authorEmail: string;
}

@Injectable()
export class CommitVerificationService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The signature status of each commit that carries one, keyed by sha.
   * Unsigned commits are absent.
   *
   * Signatures are checked on read rather than stamped at push time: keys are
   * added and removed after the fact, and the cache a commit is read from is
   * rebuilt from the log, so a stored verdict would go stale either way.
   */
  async verifyCommits({
    gitDir,
    env,
    commits,
  }: {
    gitDir: string;
    env?: Record<string, string>;
    commits: VerifiableCommit[];
  }): Promise<Map<string, CommitVerification>> {
    const verdicts = new Map<string, CommitVerification>();
    if (commits.length === 0) return verdicts;

    const signed = await readSignedCommits({
      gitDir,
      env,
      shas: commits.map((commit) => commit.sha),
    });
    if (signed.size === 0) return verdicts;

    // The key id comes from the signature itself, so one lookup covers the
    // whole page no matter how many people signed it.
    const claimed = new Map<string, string[]>();
    for (const [sha, { signature }] of signed) {
      claimed.set(sha, await signingKeyIds(signature).catch(() => []));
    }

    const keys = await this.keysById([...claimed.values()].flat());

    for (const commit of commits) {
      const entry = signed.get(commit.sha);
      if (!entry) continue;

      const keyIds = claimed.get(commit.sha) ?? [];
      verdicts.set(
        commit.sha,
        await this.judge({ ...commit, ...entry, keyIds, keys }),
      );
    }

    return verdicts;
  }

  private async judge({
    authorEmail,
    payload,
    signature,
    keyIds,
    keys,
  }: VerifiableCommit & {
    payload: string;
    signature: string;
    keyIds: string[];
    keys: Map<string, KnownKey>;
  }): Promise<CommitVerification> {
    const keyId = keyIds[0] ?? 'unknown';
    const known = keyIds.flatMap((id) => keys.get(id) ?? []);

    if (known.length === 0) {
      return {
        verified: false,
        reason: 'Signed with a key no Ghost account has uploaded',
        keyId,
      };
    }

    for (const key of known) {
      const matches = await verifySignature({
        payload,
        armoredSignature: signature,
        armoredKey: key.publicKey,
      });
      if (!matches) continue;

      // Holding a key proves who signed, never who authored: without this the
      // badge would vouch for a commit forged under someone else's address.
      if (!key.emails.includes(authorEmail.trim().toLowerCase())) {
        return {
          verified: false,
          reason: `The signing key is not linked to ${authorEmail}`,
          keyId: key.keyId,
        };
      }

      return {
        verified: true,
        reason: 'Signed and verified',
        keyId: key.keyId,
      };
    }

    return {
      verified: false,
      reason: 'Signature does not match the commit',
      keyId,
    };
  }

  /** Uploaded keys for these ids, each with the addresses its owner proved. */
  private async keysById(keyIds: string[]): Promise<Map<string, KnownKey>> {
    const wanted = [...new Set(keyIds)];
    const found = new Map<string, KnownKey>();
    if (wanted.length === 0) return found;

    const rows = await this.db
      .select({
        keyId: schema.userGpgKey.keyId,
        publicKey: schema.userGpgKey.publicKey,
        userId: schema.userGpgKey.userId,
        primaryEmail: schema.user.email,
      })
      .from(schema.userGpgKey)
      .innerJoin(schema.user, eq(schema.user.id, schema.userGpgKey.userId))
      .where(inArray(schema.userGpgKey.keyId, wanted));
    if (rows.length === 0) return found;

    const extras = await this.db
      .select({
        userId: schema.userEmail.userId,
        email: schema.userEmail.email,
      })
      .from(schema.userEmail)
      .where(
        and(
          inArray(
            schema.userEmail.userId,
            rows.map((row) => row.userId),
          ),
          eq(schema.userEmail.verified, true),
        ),
      );

    for (const row of rows) {
      found.set(row.keyId, {
        keyId: row.keyId,
        publicKey: row.publicKey,
        emails: [
          row.primaryEmail.toLowerCase(),
          ...extras
            .filter((extra) => extra.userId === row.userId)
            .map((extra) => extra.email),
        ],
      });
    }

    return found;
  }
}

interface KnownKey {
  keyId: string;
  publicKey: string;
  /** Addresses the key's owner has verified, lowercased. */
  emails: string[];
}
