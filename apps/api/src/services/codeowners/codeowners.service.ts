import { type Database, schema } from '@ghost/db';
import { atLeast } from '@ghost/permissions';
import { Inject, Injectable } from '@nestjs/common';
import { eq, inArray, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import {
  CODEOWNERS_PATHS,
  type CodeownersError,
  type CodeownersOwner,
  type LoadedCodeowners,
  MAX_CODEOWNERS_BYTES,
  matchingRule,
  ownerToken,
  parseCodeowners,
  type ResolvedOwner,
} from '../../lib/codeowners/codeowners.js';
import { statBlob } from '../../lib/git/blob/read-blob.js';
import { runGitBuffer } from '../../lib/git/exec/run-git.js';
import { usersByEmailOf } from '../../lib/github/node-lookup.js';
import { organizationTeams } from '../../lib/organizations/team-slug.js';
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
    const organizationId = owners.some((owner) => owner.kind === 'team')
      ? repository.organizationId
      : null;
    const [users, byEmail, teams, shared, organization] = await Promise.all([
      this.db
        .select({ id: schema.user.id, username: schema.user.username })
        .from(schema.user)
        .where(inArray(sql`lower(${schema.user.username})`, usernames)),
      usersByEmailOf(this.db, emails),
      organizationId ? organizationTeams(this.db, organizationId) : [],
      organizationId
        ? this.db
            .select({
              teamId: schema.repositoryTeam.teamId,
              role: schema.repositoryTeam.role,
            })
            .from(schema.repositoryTeam)
            .where(eq(schema.repositoryTeam.repositoryId, repository.id))
        : [],
      organizationId
        ? this.db
            .select({ slug: schema.organization.slug })
            .from(schema.organization)
            .where(eq(schema.organization.id, organizationId))
        : [],
    ]);
    const roles = await this.access.explicitRoles(repository.id, [
      ...new Set([...users, ...byEmail.values()].map((user) => user.id)),
    ]);

    /** The owner, or the kind of error it is reported as. */
    const check = (owner: CodeownersOwner): ResolvedOwner | string => {
      if (owner.kind === 'team') {
        const team =
          owner.organization.toLowerCase() ===
          organization[0]?.slug.toLowerCase()
            ? teams.find(
                (candidate) => candidate.slug === owner.slug.toLowerCase(),
              )
            : undefined;
        if (!team) return 'Unknown team';
        const role = shared.find((row) => row.teamId === team.id)?.role ?? null;
        if (!atLeast(role, 'write')) return 'Team without write access';
        return {
          kind: 'team',
          teamId: team.id,
          slug: team.slug,
          organization: organization[0]!.slug,
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
      if (atLeast(roles.get(user.id) ?? null, 'write')) {
        return { kind: 'user', userId: user.id, username: user.username };
      }
      // An address of an account that cannot write reads as one nobody has, so the errors do not tell who has an account.
      return owner.kind === 'email'
        ? 'Unknown owner'
        : 'Owner without write access';
    };
    const checked = new Map(
      owners.map((owner) => [ownerToken(owner).toLowerCase(), check(owner)]),
    );

    const lines = text.split(/\r?\n/);
    const ownerErrors = rules.flatMap((rule) =>
      rule.owners.flatMap((owner, index): CodeownersError[] => {
        const kind = checked.get(ownerToken(owner).toLowerCase());
        if (typeof kind !== 'string') return [];
        const needs =
          owner.kind === 'email'
            ? 'is verified and has'
            : kind.startsWith('Unknown')
              ? 'exists and has'
              : 'has';
        return [
          {
            line: rule.line,
            column: rule.ownerColumns[index],
            kind,
            source: lines[rule.line - 1],
            suggestion: null,
            message: `${kind} on line ${rule.line}: make sure ${ownerToken(owner)} ${needs} write access to the repository`,
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
        const found = checked.get(ownerToken(owner).toLowerCase());
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
