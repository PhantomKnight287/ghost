import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { errorMessage } from '../../lib/error-message.js';
import {
  BRANCH_PREFIX,
  resolveDefaultRef,
} from '../../lib/git/tree/resolve-ref.js';
import { type RefTransition, ZERO_OID } from '../../lib/git/wal/wal.types.js';
import { githubOrigins, type GithubOrigins } from '../../lib/github/origins.js';
import { ownerNameOf } from '../../lib/repositories/access/repository-access.js';
import { RepositoryMaterializerService } from '../git/materializer/repository-materializer.service.js';

/** Characters a shell reads literally, so an argument made only of them needs no quotes. */
const SHELL_SAFE = /^[\w./:@-]+$/;

/** What `git push` prints after a push to a branch: a link to the pull request it heads, or to the form that opens one, with the `gh` command doing the same. */
@Injectable()
export class PullRequestHintsService {
  private readonly logger = new Logger(PullRequestHintsService.name);
  private readonly origins: GithubOrigins;

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly materializer: RepositoryMaterializerService,
    config: ConfigService,
  ) {
    this.origins = githubOrigins(config);
  }

  /** Never rejects: a hint is advice, and a failed lookup must not fail the push it follows. */
  async hintsFor(push: {
    repositoryId: string;
    repoDirectory: string;
    transitions: RefTransition[];
  }) {
    return this.hints(push).catch((error: unknown) => {
      this.logger.warn(
        `Pull request hints failed for ${push.repositoryId}: ${errorMessage(error)}`,
      );
      return [];
    });
  }

  private async hints({
    repositoryId,
    repoDirectory,
    transitions,
  }: {
    repositoryId: string;
    repoDirectory: string;
    transitions: RefTransition[];
  }): Promise<string[]> {
    const branches = transitions
      .filter(
        ({ ref, newOid }) =>
          ref.startsWith(BRANCH_PREFIX) && !newOid.equals(ZERO_OID),
      )
      .map(({ ref }) => ref.slice(BRANCH_PREFIX.length));
    if (branches.length === 0) return [];

    // Opening the pushed repository would replay this very push into its cache ahead of receive-pack, which then refuses every new ref as existing.
    const pushed = await this.named(repositoryId, repoDirectory);
    const proposals = branches.filter(
      (branch) => branch !== pushed.defaultBranch,
    );
    if (proposals.length === 0) return [];
    // A fork's branch is proposed to the repository it was forked from, as GitHub does.
    const target = pushed.parentRepositoryId
      ? await this.named(pushed.parentRepositoryId)
      : pushed;
    const base = target.defaultBranch;

    const open = new Map(
      (
        await this.db
          .select({
            headRef: schema.pullRequest.headRef,
            number: schema.issue.number,
            owner: ownerNameOf(schema.user, schema.organization),
            slug: schema.repository.slug,
          })
          .from(schema.pullRequest)
          .innerJoin(
            schema.issue,
            eq(schema.issue.id, schema.pullRequest.issueId),
          )
          .innerJoin(
            schema.repository,
            eq(schema.repository.id, schema.pullRequest.baseRepositoryId),
          )
          .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
          .leftJoin(
            schema.organization,
            eq(schema.organization.id, schema.repository.organizationId),
          )
          .where(
            and(
              eq(schema.pullRequest.state, 'open'),
              eq(schema.pullRequest.headRepositoryId, repositoryId),
              inArray(schema.pullRequest.headRef, proposals),
            ),
          )
      ).map((request) => [request.headRef, request]),
    );

    const { web, api } = this.origins;
    const quoted = (argument: string) =>
      SHELL_SAFE.test(argument)
        ? argument
        : `'${argument.replaceAll("'", `'\\''`)}'`;

    return [
      '',
      ...proposals.flatMap((branch) => {
        const request = open.get(branch);
        if (request)
          return [
            `View the pull request for '${branch}' on Ghost:`,
            `     ${web}/${request.owner}/${request.slug}/pull/${request.number}`,
            '',
          ];

        const head = pushed.parentRepositoryId
          ? `${pushed.owner}:${branch}`
          : branch;
        const query = new URLSearchParams({ base, head });
        return [
          `Create a pull request for '${branch}' on Ghost by visiting:`,
          `     ${web}/${target.owner}/${target.slug}/pulls/new?${query}`,
          '',
          'Or with the GitHub CLI:',
          `     gh pr create --repo ${quoted(`${new URL(api).host}/${target.owner}/${target.slug}`)} --base ${quoted(base)} --head ${quoted(head)}`,
          '',
        ];
      }),
    ];
  }

  private async named(repositoryId: string, gitDir?: string) {
    const [repository] = await this.db
      .select({
        id: schema.repository.id,
        owner: ownerNameOf(schema.user, schema.organization),
        slug: schema.repository.slug,
        defaultBranch: schema.repository.defaultBranch,
        parentRepositoryId: schema.repository.parentRepositoryId,
      })
      .from(schema.repository)
      .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
      .leftJoin(
        schema.organization,
        eq(schema.organization.id, schema.repository.organizationId),
      )
      .where(eq(schema.repository.id, repositoryId));
    // Most repositories record no default branch and follow the HEAD the materializer picked.
    const defaultRef = await resolveDefaultRef({
      gitDir: gitDir ?? (await this.materializer.open(repository!)),
      defaultBranch: repository!.defaultBranch,
    });
    return {
      ...repository!,
      defaultBranch: defaultRef.slice(BRANCH_PREFIX.length),
    };
  }
}
