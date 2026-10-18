import { type Database, schema } from '@ghost/db';
import { atLeast } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import {
  CODEOWNERS_PATHS,
  type CodeownersError,
  type CodeownersOwner,
  type LoadedCodeowners,
  MAX_CODEOWNERS_BYTES,
  matchingRule,
  parseCodeowners,
  type ResolvedOwner,
} from '../../lib/codeowners/codeowners.js';
import { statBlob } from '../../lib/git/blob/read-blob.js';
import { runGitBuffer } from '../../lib/git/exec/run-git.js';
import { usersByEmailOf } from '../../lib/github/node-lookup.js';
import { teamSlug } from '../../lib/organizations/team-slug.js';
import { RepositoryAccessService } from '../git/repository-access/repository-access.service.js';

/** The CODEOWNERS file of a repository at a ref, its owners checked against users, teams and write access. */
@Injectable()
export class CodeownersService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
  ) {}

  async activePath(gitDir: string, ref: string) {
    return (await this.find(gitDir, ref))?.path ?? null;
  }

  async load(
    repository: { id: string; organizationId: string | null },
    gitDir: string,
    ref: string,
  ): Promise<LoadedCodeowners | null> {
    const file = await this.find(gitDir, ref);
    if (!file) return null;
    const text = (
      await runGitBuffer({ args: ['cat-file', 'blob', file.oid], gitDir })
    ).toString('utf8');
    const { rules, errors } = parseCodeowners(text, file.path);

    const owners = rules.flatMap((rule) => rule.owners);
    const usernames = owners.flatMap((owner) =>
      owner.kind === 'user' ? [owner.username.toLowerCase()] : [],
    );
    const emails = owners.flatMap((owner) =>
      owner.kind === 'email' ? [owner.email] : [],
    );
    const [users, byEmail, teams] = await Promise.all([
      this.db
        .select({ id: schema.user.id, username: schema.user.username })
        .from(schema.user)
        .where(inArray(sql`lower(${schema.user.username})`, usernames)),
      usersByEmailOf(this.db, emails),
      repository.organizationId && owners.some((owner) => owner.kind === 'team')
        ? this.db
            .select({
              id: schema.team.id,
              name: schema.team.name,
              organization: schema.organization.slug,
              role: schema.repositoryTeam.role,
            })
            .from(schema.team)
            .innerJoin(
              schema.organization,
              eq(schema.organization.id, schema.team.organizationId),
            )
            .leftJoin(
              schema.repositoryTeam,
              and(
                eq(schema.repositoryTeam.teamId, schema.team.id),
                eq(schema.repositoryTeam.repositoryId, repository.id),
              ),
            )
            .where(eq(schema.team.organizationId, repository.organizationId))
        : [],
    ]);
    const candidates = [...users, ...byEmail.values()];
    const writers = new Set(
      (
        await Promise.all(
          [...new Set(candidates.map((user) => user.id))].map(async (id) =>
            atLeast(await this.access.explicitRole(repository.id, id), 'write')
              ? [id]
              : [],
          ),
        )
      ).flat(),
    );

    const tokenOf = (owner: CodeownersOwner) =>
      owner.kind === 'user'
        ? `@${owner.username}`
        : owner.kind === 'team'
          ? `@${owner.organization}/${owner.slug}`
          : owner.email;
    /** The owner, or the kind of error it is reported as. */
    const check = (owner: CodeownersOwner): ResolvedOwner | string => {
      if (owner.kind === 'team') {
        const team = teams.find(
          (candidate) =>
            candidate.organization === owner.organization.toLowerCase() &&
            teamSlug(candidate.name) === owner.slug.toLowerCase(),
        );
        if (!team) return 'Unknown team';
        if (!atLeast(team.role, 'write')) return 'Team without write access';
        return {
          kind: 'team',
          teamId: team.id,
          slug: teamSlug(team.name),
          organization: team.organization,
        };
      }
      const user =
        owner.kind === 'user'
          ? users.find(
              (candidate) =>
                candidate.username?.toLowerCase() ===
                owner.username.toLowerCase(),
            )
          : byEmail.get(owner.email.toLowerCase());
      if (!user?.username) return 'Unknown owner';
      if (!writers.has(user.id)) return 'Owner without write access';
      return { kind: 'user', userId: user.id, username: user.username };
    };
    const checked = new Map(
      owners.map((owner) => [tokenOf(owner).toLowerCase(), check(owner)]),
    );

    const lines = text.split(/\r?\n/);
    const ownerErrors = rules.flatMap((rule) =>
      rule.owners.flatMap((owner, index): CodeownersError[] => {
        const kind = checked.get(tokenOf(owner).toLowerCase());
        if (typeof kind !== 'string') return [];
        const needs = kind.startsWith('Unknown') ? 'exists and has' : 'has';
        return [
          {
            line: rule.line,
            column: rule.ownerColumns[index],
            kind,
            source: lines[rule.line - 1],
            suggestion: null,
            message: `${kind} on line ${rule.line}: make sure ${tokenOf(owner)} ${needs} write access to the repository`,
            path: file.path,
          },
        ];
      }),
    );

    return {
      path: file.path,
      rules,
      errors: [...errors, ...ownerErrors].sort(
        (a, b) => a.line - b.line || a.column - b.column,
      ),
      resolve: (owner) => {
        const found = checked.get(tokenOf(owner).toLowerCase());
        return typeof found === 'object' ? found : null;
      },
    };
  }

  /** Owners of `filePath` that resolved with write access; a user named twice, by login and by email, counts once. */
  ownersOf(loaded: LoadedCodeowners, filePath: string): ResolvedOwner[] {
    const owners = (matchingRule(loaded.rules, filePath)?.owners ?? []).flatMap(
      (owner) => loaded.resolve(owner) ?? [],
    );
    return [
      ...new Map(
        owners.map((owner) => [
          owner.kind === 'user' ? owner.userId : owner.teamId,
          owner,
        ]),
      ).values(),
    ];
  }

  // Only the first file present counts: one over the limit means no CODEOWNERS, not the next file in line.
  private async find(gitDir: string, ref: string) {
    for (const path of CODEOWNERS_PATHS) {
      const blob = await statBlob({ gitDir, ref, path });
      if (blob)
        return blob.size > MAX_CODEOWNERS_BYTES
          ? null
          : { path, oid: blob.oid };
    }
    return null;
  }
}
