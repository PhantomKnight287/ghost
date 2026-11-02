import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { readSignedCommits } from '../../lib/git/commits/commit-signature.js';
import { fingerprintOf } from '../../lib/git/ssh/public-key.js';
import { GITHUB_WEB_FLOW_KEYS } from '../../lib/gpg/github-web-flow.js';
import {
  readSshSignature,
  type SshSignature,
  verifySshSignature,
} from '../../lib/ssh/sshsig.js';
import {
  publicKeyIds,
  signingKeyIds,
  verifySignature,
} from '../../lib/gpg/openpgp.js';
import { UsersService } from '../users/users.service.js';
import { CommitSigningService } from './commit-signing.service.js';

export interface CommitVerification {
  verified: boolean;
  /** Why the badge says what it says, short enough for a tooltip. */
  reason: string;
  /** Long key id the signature names, lowercase hex. */
  keyId: string;
  /** GitHub's word for the verdict, as REST `reason` and GraphQL `GitSignatureState` spell it. */
  state: SignatureState;
  /** The account whose key verified the signature; null for a platform key and for anything not `valid`, so a bad signature never names an account. */
  signerId: string | null;
}

export type SignatureState = 'valid' | 'unknown_key' | 'bad_email' | 'invalid';

export interface VerifiableCommit {
  sha: string;
  authorEmail: string;
}

@Injectable()
export class CommitVerificationService {
  private platformKeys?: Promise<Map<string, PlatformKey>>;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly users: UsersService,
    private readonly signing: CommitSigningService,
  ) {}

  /** The signature status of each commit or tag that carries one, keyed by sha; unsigned ones are absent, and a tag's `authorEmail` is its tagger's. Checked on read, not stamped at push: keys change after the fact and the cache is rebuilt from the log, so a stored verdict would go stale. */
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

    // The key id comes from the signature itself, so one lookup covers the whole page no matter how many people signed it.
    const claimed = new Map<string, string[]>();
    const ssh = new Map<string, SshSignature | null>();
    for (const [sha, { signature, format }] of signed) {
      if (format === 'ssh') ssh.set(sha, readSshSignature(signature));
      else claimed.set(sha, await signingKeyIds(signature).catch(() => []));
    }

    const [keys, sshKeys, platform] = await Promise.all([
      this.keysById([...claimed.values()].flat()),
      this.sshKeysByFingerprint(
        [...ssh.values()].flatMap((parsed) =>
          parsed ? [fingerprintOf(parsed.publicKey)] : [],
        ),
      ),
      this.platformKeysById(),
    ]);

    for (const commit of commits) {
      const entry = signed.get(commit.sha);
      if (!entry) continue;

      verdicts.set(
        commit.sha,
        entry.format === 'ssh'
          ? judgeSsh({
              ...commit,
              payload: entry.payload,
              object: entry.type,
              parsed: ssh.get(commit.sha) ?? null,
              keys: sshKeys,
            })
          : await this.judge({
              ...commit,
              ...entry,
              object: entry.type,
              keyIds: claimed.get(commit.sha) ?? [],
              keys,
              platform,
            }),
      );
    }

    return verdicts;
  }

  private async judge({
    authorEmail,
    payload,
    signature,
    object,
    keyIds,
    keys,
    platform,
  }: VerifiableCommit & {
    payload: string;
    signature: string;
    object: 'commit' | 'tag';
    keyIds: string[];
    keys: Map<string, KnownKey>;
    platform: Map<string, PlatformKey>;
  }): Promise<CommitVerification> {
    const keyId = keyIds[0] ?? 'unknown';
    const known = keyIds.flatMap((id) => keys.get(id) ?? []);
    const vouching = keyIds.flatMap((id) => platform.get(id) ?? []);

    // A platform signs what it wrote itself, under whatever author the commit names, so no address is checked. It is tried first: anyone can upload GitHub's public key to their own account.
    for (const { signer, armoredKey } of vouching) {
      if (
        await verifySignature({
          payload,
          armoredSignature: signature,
          armoredKey,
        })
      ) {
        return {
          verified: true,
          reason: `Signed by ${signer}`,
          keyId,
          state: 'valid',
          signerId: null,
        };
      }
    }

    if (known.length === 0 && vouching.length === 0) {
      return unknownKey(keyId);
    }

    for (const key of known) {
      const matches = await verifySignature({
        payload,
        armoredSignature: signature,
        armoredKey: key.publicKey,
      });
      if (!matches) continue;

      // Holding a key proves who signed, never who authored: without this the badge would vouch for a commit forged under someone else's address.
      if (!key.emails.includes(authorEmail.trim().toLowerCase())) {
        return badEmail(key.keyId, authorEmail);
      }

      return {
        verified: true,
        reason: 'Signed and verified',
        keyId: key.keyId,
        state: 'valid',
        signerId: key.userId,
      };
    }

    return mismatch(keyId, object);
  }

  /** Keys of the platforms that sign their own commits, by every key id they can sign under. */
  private platformKeysById(): Promise<Map<string, PlatformKey>> {
    this.platformKeys ??= (async () => {
      const platforms = [
        { signer: 'GitHub', armoredKey: GITHUB_WEB_FLOW_KEYS },
        ...(this.signing.publicKey
          ? [{ signer: 'Ghost', armoredKey: this.signing.publicKey }]
          : []),
      ];
      const byId = new Map<string, PlatformKey>();
      for (const platform of platforms) {
        for (const id of await publicKeyIds(platform.armoredKey)) {
          byId.set(id, platform);
        }
      }
      return byId;
    })();
    return this.platformKeys;
  }

  /** Uploaded SSH signing keys for these fingerprints, each with the addresses its owner proved. Authentication keys never sign. */
  private async sshKeysByFingerprint(
    fingerprints: string[],
  ): Promise<Map<string, KeyOwner>> {
    const found = new Map<string, KeyOwner>();
    if (fingerprints.length === 0) return found;

    const rows = await this.db
      .select({
        fingerprint: schema.userSshSigningKey.fingerprint,
        userId: schema.userSshSigningKey.userId,
      })
      .from(schema.userSshSigningKey)
      .where(
        inArray(schema.userSshSigningKey.fingerprint, [
          ...new Set(fingerprints),
        ]),
      );
    if (rows.length === 0) return found;

    const emails = await this.users.verifiedEmailsByUser(
      rows.map((row) => row.userId),
    );
    for (const row of rows)
      found.set(row.fingerprint, {
        userId: row.userId,
        emails: emails.get(row.userId) ?? [],
      });
    return found;
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
      })
      .from(schema.userGpgKey)
      .where(inArray(schema.userGpgKey.keyId, wanted));
    if (rows.length === 0) return found;

    const emails = await this.users.verifiedEmailsByUser(
      rows.map((row) => row.userId),
    );

    for (const row of rows) {
      found.set(row.keyId, {
        keyId: row.keyId,
        publicKey: row.publicKey,
        userId: row.userId,
        emails: emails.get(row.userId) ?? [],
      });
    }

    return found;
  }
}

/** The same states as OpenPGP: the signature must hold, the key must be someone's signing key, and that someone must have proved the author address. */
function judgeSsh({
  authorEmail,
  payload,
  object,
  parsed,
  keys,
}: VerifiableCommit & {
  payload: string;
  object: 'commit' | 'tag';
  parsed: SshSignature | null;
  keys: Map<string, KeyOwner>;
}): CommitVerification {
  if (!parsed) return mismatch('unknown', object);
  const fingerprint = fingerprintOf(parsed.publicKey);
  const keyId = `SHA256:${fingerprint}`;
  const owner = keys.get(fingerprint);
  if (!owner) return unknownKey(keyId);
  if (!verifySshSignature(payload, parsed)) return mismatch(keyId, object);
  if (!owner.emails.includes(authorEmail.trim().toLowerCase()))
    return badEmail(keyId, authorEmail);
  return {
    verified: true,
    reason: 'Signed and verified',
    keyId,
    state: 'valid',
    signerId: owner.userId,
  };
}

function unknownKey(keyId: string): CommitVerification {
  return {
    verified: false,
    reason: 'Signed with a key no Ghost account has uploaded',
    keyId,
    state: 'unknown_key',
    signerId: null,
  };
}

function badEmail(keyId: string, email: string): CommitVerification {
  return {
    verified: false,
    reason: `The signing key is not linked to ${email}`,
    keyId,
    state: 'bad_email',
    signerId: null,
  };
}

function mismatch(keyId: string, object: 'commit' | 'tag'): CommitVerification {
  return {
    verified: false,
    reason: `Signature does not match the ${object}`,
    keyId,
    state: 'invalid',
    signerId: null,
  };
}

interface KeyOwner {
  userId: string;
  /** Addresses the key's owner has verified, lowercased. */
  emails: string[];
}

interface KnownKey extends KeyOwner {
  keyId: string;
  publicKey: string;
}

interface PlatformKey {
  /** Who the badge says signed, such as `GitHub`. */
  signer: string;
  armoredKey: string;
}
