import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, ne, or, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { Executor } from '../../lib/db/executor.js';
import { publishEvent } from '../../lib/events/events.js';
import { touchIssue } from '../../lib/issues/touch-issue.js';
import { teamSlug } from '../../lib/organizations/team-slug.js';
import {
  PullRequestNotOpenError,
  ReviewerNotEligibleError,
  ReviewerNotFoundError,
  TooManyReviewersError,
} from '../../lib/pull-requests/pull-requests.errors.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import {
  type PullRequestRef,
  PullRequestsService,
} from './pull-requests.service.js';

export type RequestedReviewers = {
  users: {
    id: string;
    username: string;
    name: string | null;
    image: string | null;
    asCodeOwner: boolean;
  }[];
  teams: { id: string; slug: string; name: string; asCodeOwner: boolean }[];
};

type ReviewersRef = PullRequestRef & {
  requesterId: string;
  users: string[];
  teams: string[];
};

type Reviewers = {
  users: { id: string; username: string }[];
  teams: { id: string; slug: string }[];
};

const MAX_REVIEWERS = 15;

/** Who is asked to review a pull request. A request stays pending until it is answered or removed; a cleared row is kept so CODEOWNERS can tell who was ever asked. */
@Injectable()
export class ReviewRequestsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly pullRequests: PullRequestsService,
  ) {}

  async list(params: PullRequestRef): Promise<RequestedReviewers> {
    const { pullRequest } = await this.pullRequests.load(params);
    return this.pending(pullRequest.id);
  }

  async request(params: ReviewersRef): Promise<RequestedReviewers> {
    const { pullRequest, base } = await this.pullRequests.load({
      ...params,
      operation: 'triage',
    });
    if (pullRequest.state !== 'open') {
      throw new PullRequestNotOpenError(pullRequest.state);
    }
    if (
      new Set(params.users).size + new Set(params.teams).size >
      MAX_REVIEWERS
    ) {
      throw new TooManyReviewersError();
    }

    const named = await this.resolve(base.id, params.users, params.teams);
    const userIds = named.users.map((user) => user.id);
    const teamIds = named.teams.map((team) => team.id);
    const eligible = await this.eligible(this.db, {
      repositoryId: base.id,
      authorId: pullRequest.authorId,
      userIds,
      teamIds,
    });
    const allowed = new Set(
      [...eligible.users, ...eligible.teams].map((reviewer) => reviewer.id),
    );
    const refused = [
      ...named.users.map((user) => ({ id: user.id, name: user.username })),
      ...named.teams.map((team) => ({ id: team.id, name: team.slug })),
    ].find((reviewer) => !allowed.has(reviewer.id));
    if (refused) throw new ReviewerNotEligibleError(refused.name);

    await this.db.transaction((tx) =>
      this.addRequests(tx, {
        pullRequestId: pullRequest.id,
        issueId: pullRequest.issueId,
        repositoryId: base.id,
        authorId: pullRequest.authorId,
        actorId: params.requesterId,
        userIds,
        teamIds,
        asCodeOwner: false,
      }),
    );
    return this.pending(pullRequest.id);
  }

  async remove(params: ReviewersRef): Promise<RequestedReviewers> {
    const { pullRequest, base } = await this.pullRequests.load({
      ...params,
      operation: 'triage',
    });
    const named = await this.resolve(base.id, params.users, params.teams);

    await this.db.transaction(async (tx) => {
      const removed = await tx
        .update(schema.pullRequestReviewRequest)
        .set({ clearedAt: new Date(), clearedReason: 'removed' })
        .where(
          and(
            eq(schema.pullRequestReviewRequest.pullRequestId, pullRequest.id),
            isNull(schema.pullRequestReviewRequest.clearedAt),
            or(
              inArray(
                schema.pullRequestReviewRequest.reviewerUserId,
                named.users.map((user) => user.id),
              ),
              inArray(
                schema.pullRequestReviewRequest.reviewerTeamId,
                named.teams.map((team) => team.id),
              ),
            ),
          ),
        )
        .returning({
          reviewerUserId: schema.pullRequestReviewRequest.reviewerUserId,
          reviewerTeamId: schema.pullRequestReviewRequest.reviewerTeamId,
        });
      await this.record(tx, 'review_request_removed', removed, named, {
        issueId: pullRequest.issueId,
        repositoryId: base.id,
        actorId: params.requesterId,
      });
    });
    return this.pending(pullRequest.id);
  }

  /** Requests whoever of `userIds` and `teamIds` may review and is not already pending, without checking the actor's permission. Returns who was added. */
  async addRequests(
    tx: Executor,
    args: {
      pullRequestId: string;
      issueId: string;
      repositoryId: string;
      authorId: string;
      actorId: string | null;
      userIds: string[];
      teamIds: string[];
      asCodeOwner: boolean;
    },
  ): Promise<{ userIds: string[]; teamIds: string[] }> {
    const eligible = await this.eligible(tx, args);
    if (eligible.users.length === 0 && eligible.teams.length === 0) {
      return { userIds: [], teamIds: [] };
    }

    const request = {
      pullRequestId: args.pullRequestId,
      requestedById: args.actorId,
      asCodeOwner: args.asCodeOwner,
    };
    // A reviewer already pending hits the partial unique index and is skipped.
    const added = await tx
      .insert(schema.pullRequestReviewRequest)
      .values([
        ...eligible.users.map((user) => ({
          ...request,
          reviewerUserId: user.id,
        })),
        ...eligible.teams.map((team) => ({
          ...request,
          reviewerTeamId: team.id,
        })),
      ])
      .onConflictDoNothing()
      .returning({
        reviewerUserId: schema.pullRequestReviewRequest.reviewerUserId,
        reviewerTeamId: schema.pullRequestReviewRequest.reviewerTeamId,
      });
    await this.record(tx, 'review_requested', added, eligible, args);

    return {
      userIds: added.flatMap((row) => row.reviewerUserId ?? []),
      teamIds: added.flatMap((row) => row.reviewerTeamId ?? []),
    };
  }

  /** The reviewer's own request and their teams' requests are answered by the review; teams are recorded on it as the ones it was submitted for. */
  async clearForReview(
    tx: Executor,
    args: { pullRequestId: string; reviewerId: string; reviewId: string },
  ): Promise<void> {
    const cleared = await tx
      .update(schema.pullRequestReviewRequest)
      .set({ clearedAt: new Date(), clearedReason: 'reviewed' })
      .where(
        and(
          eq(schema.pullRequestReviewRequest.pullRequestId, args.pullRequestId),
          isNull(schema.pullRequestReviewRequest.clearedAt),
          or(
            eq(schema.pullRequestReviewRequest.reviewerUserId, args.reviewerId),
            inArray(
              schema.pullRequestReviewRequest.reviewerTeamId,
              tx
                .select({ id: schema.teamMember.teamId })
                .from(schema.teamMember)
                .where(eq(schema.teamMember.userId, args.reviewerId)),
            ),
          ),
        ),
      )
      .returning({ teamId: schema.pullRequestReviewRequest.reviewerTeamId });
    const teamIds = cleared.flatMap((row) => row.teamId ?? []);
    if (teamIds.length === 0) return;
    await tx
      .insert(schema.pullRequestReviewOnBehalfOf)
      .values(teamIds.map((teamId) => ({ reviewId: args.reviewId, teamId })));
  }

  private async pending(pullRequestId: string): Promise<RequestedReviewers> {
    const pending = and(
      eq(schema.pullRequestReviewRequest.pullRequestId, pullRequestId),
      isNull(schema.pullRequestReviewRequest.clearedAt),
    );
    const [users, teams] = await Promise.all([
      this.db
        .select({
          id: schema.user.id,
          username: sql<string>`coalesce(${schema.user.username}, '')`,
          name: schema.user.name,
          image: schema.user.image,
          asCodeOwner: schema.pullRequestReviewRequest.asCodeOwner,
        })
        .from(schema.pullRequestReviewRequest)
        .innerJoin(
          schema.user,
          eq(schema.user.id, schema.pullRequestReviewRequest.reviewerUserId),
        )
        .where(pending)
        .orderBy(asc(schema.pullRequestReviewRequest.createdAt)),
      this.db
        .select({
          id: schema.team.id,
          name: schema.team.name,
          asCodeOwner: schema.pullRequestReviewRequest.asCodeOwner,
        })
        .from(schema.pullRequestReviewRequest)
        .innerJoin(
          schema.team,
          eq(schema.team.id, schema.pullRequestReviewRequest.reviewerTeamId),
        )
        .where(pending)
        .orderBy(asc(schema.pullRequestReviewRequest.createdAt)),
    ]);
    return {
      users,
      teams: teams.map((team) => ({ ...team, slug: teamSlug(team.name) })),
    };
  }

  /** Users by username and the repository's organization's teams by slug, failing on the first name that matches nothing. */
  private async resolve(
    repositoryId: string,
    usernames: string[],
    slugs: string[],
  ): Promise<Reviewers> {
    const [users, teams] = await Promise.all([
      this.db
        .select({
          id: schema.user.id,
          username: sql<string>`coalesce(${schema.user.username}, '')`,
        })
        .from(schema.user)
        .where(inArray(schema.user.username, usernames)),
      // A user's repository has no organization, so it joins no teams.
      this.db
        .select({ id: schema.team.id, name: schema.team.name })
        .from(schema.team)
        .innerJoin(
          schema.repository,
          eq(schema.repository.organizationId, schema.team.organizationId),
        )
        .where(eq(schema.repository.id, repositoryId)),
    ]);

    const missingUser = usernames.find(
      (username) => !users.some((user) => user.username === username),
    );
    if (missingUser !== undefined) throw new ReviewerNotFoundError(missingUser);
    const named = slugs.map((slug) => ({
      slug,
      team: teams.find((team) => teamSlug(team.name) === slug),
    }));
    const missingTeam = named.find(({ team }) => !team);
    if (missingTeam) throw new ReviewerNotFoundError(missingTeam.slug);

    return {
      users,
      teams: named.flatMap(({ slug, team }) =>
        team ? [{ id: team.id, slug }] : [],
      ),
    };
  }

  /** Users with a role of their own on the repository, other than the author, and teams the repository is shared with. */
  private async eligible(
    db: Executor,
    args: {
      repositoryId: string;
      authorId: string;
      userIds: string[];
      teamIds: string[];
    },
  ): Promise<Reviewers> {
    const [users, teams] = await Promise.all([
      db
        .select({
          id: schema.user.id,
          username: sql<string>`coalesce(${schema.user.username}, '')`,
        })
        .from(schema.user)
        .where(
          and(
            inArray(schema.user.id, args.userIds),
            ne(schema.user.id, args.authorId),
          ),
        ),
      db
        .select({ id: schema.team.id, name: schema.team.name })
        .from(schema.team)
        .innerJoin(
          schema.repositoryTeam,
          and(
            eq(schema.repositoryTeam.teamId, schema.team.id),
            eq(schema.repositoryTeam.repositoryId, args.repositoryId),
          ),
        )
        .where(inArray(schema.team.id, args.teamIds)),
    ]);
    const roles = await Promise.all(
      users.map((user) => this.access.explicitRole(args.repositoryId, user.id)),
    );
    return {
      users: users.filter((_, index) => roles[index] !== null),
      teams: teams.map((team) => ({ id: team.id, slug: teamSlug(team.name) })),
    };
  }

  /** The timeline and outbox events for requests added or removed, named as they are now since the timeline keeps the name. */
  private async record(
    tx: Executor,
    action: 'review_requested' | 'review_request_removed',
    rows: { reviewerUserId: string | null; reviewerTeamId: string | null }[],
    names: Reviewers,
    context: { issueId: string; repositoryId: string; actorId: string | null },
  ) {
    for (const row of rows) {
      await tx.insert(schema.issueEvent).values({
        issueId: context.issueId,
        actorId: context.actorId,
        type: action,
        requestedReviewerUsername: names.users.find(
          (user) => user.id === row.reviewerUserId,
        )?.username,
        requestedTeamSlug: names.teams.find(
          (team) => team.id === row.reviewerTeamId,
        )?.slug,
      });
      await publishEvent(tx, {
        type: `pull_request.${action}`,
        repositoryId: context.repositoryId,
        actorId: context.actorId,
        payload: {
          issueId: context.issueId,
          requestedUserId: row.reviewerUserId ?? undefined,
          requestedTeamId: row.reviewerTeamId ?? undefined,
        },
      });
    }
    if (rows.length > 0) await touchIssue(tx, context.issueId);
  }
}
