import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, eq, sql } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { runGit, runGitStream } from '../../../lib/git/exec/run-git.js';
import { resolveCommit } from '../../../lib/git/tree/resolve-ref.js';
import { languageForPath } from '@ghost/languages';

const INSERT_CHUNK = 1_000;

/** Symlinks and submodules are not files of the repository, so they hold no bytes. */
const SKIPPED_MODES = new Set(['120000', '160000']);

export interface LanguageBytes {
  language: string;
  bytes: number;
}

@Injectable()
export class RepositoryLanguageService {
  private readonly logger = new Logger(RepositoryLanguageService.name);
  private readonly inFlight = new Map<string, Promise<LanguageBytes[]>>();

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async getLanguages({
    repositoryId,
    repoDirectory,
    ref,
  }: {
    repositoryId: string;
    repoDirectory: string;
    ref: string;
  }): Promise<LanguageBytes[]> {
    const key = `${repositoryId}:${ref}`;
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const run = this.sync({ repositoryId, repoDirectory, ref }).finally(() =>
      this.inFlight.delete(key),
    );
    this.inFlight.set(key, run);
    return run;
  }

  private async sync({
    repositoryId,
    repoDirectory,
    ref,
  }: {
    repositoryId: string;
    repoDirectory: string;
    ref: string;
  }): Promise<LanguageBytes[]> {
    const tip = await resolveCommit(repoDirectory, ref);
    if (!tip) {
      await this.forget(repositoryId, ref);
      return [];
    }

    const [state] = await this.db
      .select()
      .from(schema.repositoryLanguageIndex)
      .where(
        and(
          eq(schema.repositoryLanguageIndex.repositoryId, repositoryId),
          eq(schema.repositoryLanguageIndex.ref, ref),
        ),
      );

    if (state?.indexedCommitSha === tip) return this.read(repositoryId, ref);

    // Only a fast-forward can be topped up: a force push or a pruned object makes the stored totals unrelated to the three, so count it again
    const incremental =
      state !== undefined &&
      (await this.isAncestor(repoDirectory, state.indexedCommitSha, tip));

    const totals = incremental
      ? await this.applyDiff({
          repoDirectory,
          from: state!.indexedCommitSha,
          to: tip,
          totals: await this.readMap(repositoryId, ref),
        })
      : await this.countTree(repoDirectory, tip);

    await this.forget(repositoryId, ref);
    await this.write(repositoryId, ref, tip, totals);

    this.logger.log(
      `Counted ${totals.size} languages for ${repositoryId} ${ref} (${
        incremental ? `${state!.indexedCommitSha}..${tip}` : 'full recount'
      })`,
    );

    return sorted(totals);
  }

  private async countTree(repoDirectory: string, tip: string) {
    const totals = new Map<string, number>();

    const records = splitRecords(
      runGitStream({
        args: ['ls-tree', '-r', '-l', '-z', '--end-of-options', tip],
        gitDir: repoDirectory,
      }),
    );

    for await (const record of records) {
      // "<mode> <type> <oid> <size>\t<path>", size padded, "-" for non-blobs
      const tab = record.indexOf('\t');
      if (tab === -1) continue;

      const [mode, type, , size] = record.slice(0, tab).trim().split(/\s+/);
      if (type !== 'blob' || SKIPPED_MODES.has(mode)) continue;

      add(totals, record.slice(tab + 1), Number(size));
    }

    return totals;
  }

  private async applyDiff({
    repoDirectory,
    from,
    to,
    totals,
  }: {
    repoDirectory: string;
    from: string;
    to: string;
    totals: Map<string, number>;
  }) {
    const changes = await readRawDiff(repoDirectory, from, to);
    const sizes = await this.sizesOf(
      repoDirectory,
      changes.flatMap(({ before, after }) =>
        [before?.oid, after?.oid].filter((oid): oid is string => Boolean(oid)),
      ),
    );

    for (const { before, after } of changes) {
      if (before) add(totals, before.path, -(sizes.get(before.oid) ?? 0));
      if (after) add(totals, after.path, sizes.get(after.oid) ?? 0);
    }

    // a size git no longer agrees with would otherwise drift negative forever
    for (const [language, bytes] of totals) {
      if (bytes <= 0) totals.delete(language);
    }

    return totals;
  }

  private async sizesOf(repoDirectory: string, oids: string[]) {
    const sizes = new Map<string, number>();
    if (oids.length === 0) return sizes;

    const output = await runGit({
      args: [
        'cat-file',
        '--batch-check=%(objectname) %(objecttype) %(objectsize)',
      ],
      gitDir: repoDirectory,
      input: Buffer.from(`${[...new Set(oids)].join('\n')}\n`),
    });

    for (const line of output.split('\n')) {
      const [oid, type, size] = line.trim().split(' ');
      if (type === 'blob') sizes.set(oid, Number(size));
    }

    return sizes;
  }

  private async read(repositoryId: string, ref: string) {
    return sorted(await this.readMap(repositoryId, ref));
  }

  private async readMap(repositoryId: string, ref: string) {
    const rows = await this.db
      .select({
        language: schema.repositoryLanguageStat.language,
        bytes: schema.repositoryLanguageStat.bytes,
      })
      .from(schema.repositoryLanguageStat)
      .where(
        and(
          eq(schema.repositoryLanguageStat.repositoryId, repositoryId),
          eq(schema.repositoryLanguageStat.ref, ref),
        ),
      );

    return new Map(rows.map(({ language, bytes }) => [language, bytes]));
  }

  private async write(
    repositoryId: string,
    ref: string,
    tip: string,
    totals: Map<string, number>,
  ) {
    const rows = [...totals]
      .filter(([, bytes]) => bytes > 0)
      .map(([language, bytes]) => ({ repositoryId, ref, language, bytes }));

    for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
      await this.db
        .insert(schema.repositoryLanguageStat)
        .values(rows.slice(i, i + INSERT_CHUNK))
        .onConflictDoUpdate({
          target: [
            schema.repositoryLanguageStat.repositoryId,
            schema.repositoryLanguageStat.ref,
            schema.repositoryLanguageStat.language,
          ],
          set: { bytes: sql`excluded."bytes"` },
        });
    }

    await this.db
      .insert(schema.repositoryLanguageIndex)
      .values({ repositoryId, ref, indexedCommitSha: tip })
      .onConflictDoUpdate({
        target: [
          schema.repositoryLanguageIndex.repositoryId,
          schema.repositoryLanguageIndex.ref,
        ],
        set: { indexedCommitSha: tip, updatedAt: new Date() },
      });
  }

  private async forget(repositoryId: string, ref: string) {
    await this.db
      .delete(schema.repositoryLanguageStat)
      .where(
        and(
          eq(schema.repositoryLanguageStat.repositoryId, repositoryId),
          eq(schema.repositoryLanguageStat.ref, ref),
        ),
      );
    await this.db
      .delete(schema.repositoryLanguageIndex)
      .where(
        and(
          eq(schema.repositoryLanguageIndex.repositoryId, repositoryId),
          eq(schema.repositoryLanguageIndex.ref, ref),
        ),
      );
  }

  private async isAncestor(
    repoDirectory: string,
    ancestor: string,
    descendant: string,
  ) {
    return runGit({
      args: ['merge-base', '--is-ancestor', ancestor, descendant],
      gitDir: repoDirectory,
    }).then(
      () => true,
      () => false,
    );
  }
}

interface Side {
  path: string;
  oid: string;
}

export interface RawChange {
  before?: Side;
  after?: Side;
}

/**
 * `git diff --raw -r -z` as sides to subtract and add.
 *
 * Each entry is ":<srcmode> <dstmode> <srcoid> <dstoid> <status>" followed by one path, or two for a rename or copy. Symlinks and submodules are dropped per side, so a file becoming a symlink still subtracts its old bytes.
 */
export async function readRawDiff(
  gitDir: string,
  from: string,
  to: string,
): Promise<RawChange[]> {
  const raw = await runGit({
    args: [
      'diff',
      '--raw',
      '-r',
      '-z',
      '--no-abbrev', // --no-abbrev keeps the oids full, which is what cat-file echoes back
      '--end-of-options',
      from,
      to,
    ],
    gitDir,
  });

  const fields = raw.split('\0');
  const changes: RawChange[] = [];

  for (let i = 0; i < fields.length; i++) {
    if (!fields[i].startsWith(':')) continue;

    const [srcMode, dstMode, srcOid, dstOid, status] = fields[i]
      .slice(1)
      .split(' ');
    // a rename or a copy names the destination in a second path field
    const renamed = status?.startsWith('R') || status?.startsWith('C');
    const srcPath = fields[++i];
    const dstPath = renamed ? fields[++i] : srcPath;
    if (srcPath === undefined || dstPath === undefined) break;

    changes.push({
      before: isCounted(srcMode, srcOid)
        ? { path: srcPath, oid: srcOid }
        : undefined,
      after: isCounted(dstMode, dstOid)
        ? { path: dstPath, oid: dstOid }
        : undefined,
    });
  }

  return changes;
}

function isCounted(mode: string, oid: string) {
  return !SKIPPED_MODES.has(mode) && !/^0+$/.test(oid);
}

/** NUL-terminated records, streamed, so a large tree is never held whole. */
async function* splitRecords(chunks: AsyncIterable<string>) {
  let carry = '';

  for await (const chunk of chunks) {
    carry += chunk;
    const records = carry.split('\0');
    carry = records.pop() ?? '';
    for (const record of records) if (record) yield record;
  }

  if (carry) yield carry;
}

function add(totals: Map<string, number>, path: string, bytes: number) {
  const language = languageForPath(path);
  if (!language || !Number.isFinite(bytes)) return;
  totals.set(language, (totals.get(language) ?? 0) + bytes);
}

function sorted(totals: Map<string, number>): LanguageBytes[] {
  return [...totals]
    .filter(([, bytes]) => bytes > 0)
    .map(([language, bytes]) => ({ language, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
}
