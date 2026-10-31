import { Inject, Injectable, Logger } from '@nestjs/common';
import { type Database, schema } from '@ghost/db';
import { and, eq } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { runGit, runGitStream } from '../../../lib/git/exec/run-git.js';
import { resolveCommit } from '../../../lib/git/tree/resolve-ref.js';
import { type LinguistAttributes, statsLanguage } from '@ghost/languages';
import { excluded } from '../../../lib/db/sql.js';
import { isAncestor } from '../../../lib/git/diff/diff.js';
import { SingleFlight } from '../../../lib/single-flight.js';
import { splitRecords } from '../../../lib/git/exec/split-records.js';
import {
  isGitAttributes,
  readAttributes,
  readRawDiff,
  SKIPPED_MODES,
} from '../../../lib/git/languages/git-files.js';

const INSERT_CHUNK = 1_000;

export interface LanguageBytes {
  language: string;
  bytes: number;
}

@Injectable()
export class RepositoryLanguageService {
  private readonly logger = new Logger(RepositoryLanguageService.name);
  private readonly inFlight = new SingleFlight<LanguageBytes[]>();

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
    return this.inFlight.run(key, () =>
      this.sync({ repositoryId, repoDirectory, ref }),
    );
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
      (await isAncestor(repoDirectory, state.indexedCommitSha, tip));

    const delta = incremental
      ? await this.applyDiff({
          repoDirectory,
          from: state!.indexedCommitSha,
          to: tip,
          totals: await this.readMap(repositoryId, ref),
        })
      : null;
    const totals = delta ?? (await this.countTree(repoDirectory, tip));

    await this.forget(repositoryId, ref);
    await this.write(repositoryId, ref, tip, totals);

    this.logger.log(
      `Counted ${totals.size} languages for ${repositoryId} ${ref} (${
        delta ? `${state!.indexedCommitSha}..${tip}` : 'full recount'
      })`,
    );

    return sorted(totals);
  }

  private async countTree(repoDirectory: string, tip: string) {
    // ponytail: every blob's path is held until the attributes are read; stream them through check-attr if trees outgrow memory
    const files: { file: string; size: number }[] = [];

    const records = splitRecords(
      runGitStream({
        args: ['ls-tree', '-r', '-l', '-z', '--end-of-options', tip],
        gitDir: repoDirectory,
      }),
      '\0',
    );

    for await (const record of records) {
      // "<mode> <type> <oid> <size>\t<path>", size padded, "-" for non-blobs
      const tab = record.indexOf('\t');
      if (tab === -1) continue;

      const [mode, type, , size] = record.slice(0, tab).trim().split(/\s+/);
      if (type !== 'blob' || SKIPPED_MODES.has(mode)) continue;

      files.push({ file: record.slice(tab + 1), size: Number(size) });
    }

    const attributes = files.some(({ file }) => isGitAttributes(file))
      ? await readAttributes(
          repoDirectory,
          tip,
          files.map(({ file }) => file),
        )
      : new Map<string, LinguistAttributes>();

    const totals = new Map<string, number>();
    for (const { file, size } of files) {
      add(totals, file, size, attributes.get(file));
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
  }): Promise<Map<string, number> | null> {
    const changes = await readRawDiff(repoDirectory, from, to);

    const files = changes.flatMap(({ before, after }) =>
      [before?.path, after?.path].filter((file): file is string =>
        Boolean(file),
      ),
    );
    // a changed .gitattributes can move any file in or out of the stats, so the stored totals no longer apply
    if (files.some(isGitAttributes)) return null;

    // .gitattributes is the same at both ends, so `to` decides for the old paths too
    const attributes = await readAttributes(repoDirectory, to, files);
    const sizes = await this.sizesOf(
      repoDirectory,
      changes.flatMap(({ before, after }) =>
        [before?.oid, after?.oid].filter((oid): oid is string => Boolean(oid)),
      ),
    );

    for (const { before, after } of changes) {
      if (before) {
        add(
          totals,
          before.path,
          -(sizes.get(before.oid) ?? 0),
          attributes.get(before.path),
        );
      }
      if (after) {
        add(
          totals,
          after.path,
          sizes.get(after.oid) ?? 0,
          attributes.get(after.path),
        );
      }
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
          set: { bytes: excluded(schema.repositoryLanguageStat.bytes) },
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
}

function add(
  totals: Map<string, number>,
  path: string,
  bytes: number,
  attributes?: LinguistAttributes,
) {
  const language = statsLanguage(path, attributes);
  if (!language || !Number.isFinite(bytes)) return;
  totals.set(language, (totals.get(language) ?? 0) + bytes);
}

function sorted(totals: Map<string, number>): LanguageBytes[] {
  return [...totals]
    .filter(([, bytes]) => bytes > 0)
    .map(([language, bytes]) => ({ language, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
}
