import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gte, type SQL, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DATABASE } from '../../../database/database.module.js';
import { isoTimestamp } from '../../../lib/db/sql.js';
import { GithubNotFoundError } from '../../../lib/github/github.errors.js';
import { encodeNodeId } from '../../../lib/github/node-id.js';
import {
  authorAssociation,
  type Page,
  pageOf,
  RestPage,
} from '../../../lib/github/rest.js';
import { visibleReview } from '../../../lib/pull-requests/reviews.js';
import { PullRequestsService } from '../../../resources/pull-requests/pull-requests.service.js';
import { ReviewsService } from '../../../resources/pull-requests/reviews.service.js';
import type {
  GithubRepositoryTarget,
  GithubViewer,
} from '../../auth/github-request.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import type {
  GithubCommentDTO,
  GithubListCommentsQueryDTO,
} from '../issues/dto/issue.dto.js';
import { GithubIssuesService } from '../issues/issues.service.js';
import type {
  GithubCreateReviewCommentDTO,
  GithubReviewCommentDTO,
} from './dto/review-comment.dto.js';
import { GithubReviewsService } from './reviews.service.js';

const comment = schema.pullRequestReviewComment;
const thread = alias(schema.pullRequestReviewComment, 'thread');

/** GitHub's REST review comments over ReviewsService, by GitHub's integer ids. A pending comment is its author's alone. */
@Injectable()
export class GithubReviewCommentsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly github: GithubIssuesService,
    private readonly pulls: PullRequestsService,
    private readonly reviews: ReviewsService,
    private readonly githubReviews: GithubReviewsService,
  ) {}

  async listForRepository(
    { owner, repo, viewer }: GithubRepositoryTarget,
    query: GithubListCommentsQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    return this.page(repository, viewer, query, undefined);
  }

  async list(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    query: GithubListCommentsQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const { pullRequest } = await this.pulls.load({
      ...this.github.ref(repository, viewer),
      number,
    });
    return this.page(
      repository,
      viewer,
      query,
      eq(comment.pullRequestId, pullRequest.id),
    );
  }

  async listForReview(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    reviewId: number,
    query: GithubListCommentsQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const { pullRequest } = await this.pulls.load({
      ...this.github.ref(repository, viewer),
      number,
    });
    const [review] = await this.db
      .select({ id: schema.pullRequestReview.id })
      .from(schema.pullRequestReview)
      .where(
        and(
          eq(schema.pullRequestReview.numericId, reviewId),
          eq(schema.pullRequestReview.pullRequestId, pullRequest.id),
          visibleReview(viewer?.userId),
        ),
      );
    if (!review) throw new GithubNotFoundError();
    return this.page(
      repository,
      viewer,
      query,
      eq(comment.reviewId, review.id),
    );
  }

  async get({ owner, repo, viewer }: GithubRepositoryTarget, id: number) {
    const repository = await this.github.readable(owner, repo, viewer);
    const {
      items: [found],
    } = await this.comments(repository, viewer, eq(comment.numericId, id));
    if (!found) throw new GithubNotFoundError();
    return found;
  }

  /** A line comment in a review of its own, as GitHub records one; with `in_reply_to`, a reply in that comment's thread. */
  async create(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    body: GithubCreateReviewCommentDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/pulls/:number/comments',
    );
    const ref = {
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      number,
    };
    if (body.in_reply_to !== undefined) {
      const replied = await this.ghostComment(
        repository,
        signedIn,
        body.in_reply_to,
      );
      const reply = await this.reviews.replyToComment({
        ...ref,
        commentId: replied.id,
        body: body.body,
      });
      const { items } = await this.comments(
        repository,
        signedIn,
        eq(comment.id, reply.id),
      );
      return items[0];
    }
    // DTO validation requires `path` and `line` without `in_reply_to`.
    const review = await this.githubReviews.submit(ref, {
      event: 'COMMENT',
      commitSha: body.commit_id,
      separate: true,
      comments: [{ ...body, path: body.path!, line: body.line! }],
    });
    const { items } = await this.comments(
      repository,
      signedIn,
      eq(comment.reviewId, review.id),
    );
    return items[0];
  }

  /** Only the comment's author may, as Ghost allows. */
  async update(
    { owner, repo, viewer }: GithubRepositoryTarget,
    id: number,
    body: GithubCommentDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'PATCH /repos/:owner/:repo/pulls/comments/:comment_id',
    );
    const found = await this.ghostComment(repository, signedIn, id);
    await this.reviews.updateComment({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      number: found.number,
      commentId: found.id,
      body: body.body,
    });
    const { items } = await this.comments(
      repository,
      signedIn,
      eq(comment.id, found.id),
    );
    return items[0];
  }

  async delete({ owner, repo, viewer }: GithubRepositoryTarget, id: number) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'DELETE /repos/:owner/:repo/pulls/comments/:comment_id',
    );
    const found = await this.ghostComment(repository, signedIn, id);
    await this.reviews.deleteComment({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      number: found.number,
      commentId: found.id,
    });
  }

  /** GitHub ignores `direction` without `sort`, listing oldest first. */
  private async page(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    query: GithubListCommentsQueryDTO,
    where: SQL | undefined,
  ) {
    const page = pageOf(query);
    const column =
      query.sort === 'updated' ? comment.updatedAt : comment.createdAt;
    const direction = query.sort ? (query.direction ?? 'desc') : 'asc';
    const { items, total } = await this.comments(
      repository,
      viewer,
      and(
        where,
        query.since ? gte(comment.updatedAt, new Date(query.since)) : undefined,
      ),
      { page, orderBy: direction === 'asc' ? asc(column) : desc(column) },
    );
    return new RestPage(items, page, total);
  }

  /** The Ghost id and pull request number behind a visible comment's integer id. */
  private async ghostComment(
    repository: RepositoryNode,
    viewer: GithubViewer,
    numericId: number,
  ) {
    const [found] = await this.db
      .select({ id: comment.id, number: schema.issue.number })
      .from(comment)
      .innerJoin(
        schema.pullRequest,
        eq(schema.pullRequest.id, comment.pullRequestId),
      )
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .innerJoin(
        schema.pullRequestReview,
        eq(schema.pullRequestReview.id, comment.reviewId),
      )
      .where(
        and(
          eq(comment.numericId, numericId),
          eq(schema.issue.repositoryId, repository.ghostId),
          visibleReview(viewer.userId),
        ),
      );
    if (!found) throw new GithubNotFoundError();
    return found;
  }

  /** Comments the viewer can see in the repository's pull requests as GitHub's `pull-request-review-comment`, one page of them when `list` is given. */
  private async comments(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    where: SQL | undefined,
    list?: { page: Page; orderBy: SQL },
  ): Promise<{ total: number; items: GithubReviewCommentDTO[] }> {
    const query = this.db
      .select({
        id: comment.id,
        numericId: comment.numericId,
        reviewNumericId: schema.pullRequestReview.numericId,
        inReplyToNumericId: thread.numericId,
        number: schema.issue.number,
        authorLogin: sql<string>`coalesce(${schema.user.username}, '')`,
        path: comment.path,
        side: comment.side,
        line: comment.line,
        startSide: comment.startSide,
        startLine: comment.startLine,
        commitSha: comment.commitSha,
        // Replies keep no hunk of their own; GitHub shows the thread's on each.
        diffHunk: sql<
          string | null
        >`coalesce(${comment.diffHunk}, ${thread.diffHunk})`,
        body: comment.body,
        createdAt: isoTimestamp(comment.createdAt),
        updatedAt: isoTimestamp(comment.updatedAt),
        total: sql<number>`count(*) over ()`.mapWith(Number),
      })
      .from(comment)
      .innerJoin(
        schema.pullRequest,
        eq(schema.pullRequest.id, comment.pullRequestId),
      )
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .innerJoin(schema.user, eq(schema.user.id, comment.authorId))
      .innerJoin(
        schema.pullRequestReview,
        eq(schema.pullRequestReview.id, comment.reviewId),
      )
      .leftJoin(thread, eq(thread.id, comment.inReplyToId))
      .where(
        and(
          eq(schema.issue.repositoryId, repository.ghostId),
          visibleReview(viewer?.userId),
          where,
        ),
      )
      .$dynamic();
    const rows = await (list
      ? query
          .orderBy(list.orderBy, asc(comment.numericId))
          .offset(list.page.offset)
          .limit(list.page.perPage)
      : query);
    const context = await this.github.context(repository, {
      logins: rows.map((row) => row.authorLogin),
      labels: [],
    });
    const { apiUrl, webUrl } = context.repository;
    return {
      // ponytail: the total rides on each row, so a page past the end reports 0 and its Link header names no earlier pages; add a count query if a client pages that far.
      total: rows[0]?.total ?? 0,
      items: rows.map((row) => {
        const url = `${apiUrl}/pulls/comments/${row.numericId}`;
        const htmlUrl = `${webUrl}/pull/${row.number}#discussion_r${row.id}`;
        const pullUrl = `${apiUrl}/pulls/${row.number}`;
        return {
          url,
          pull_request_review_id: row.reviewNumericId,
          id: row.numericId,
          node_id: encodeNodeId('PullRequestReviewComment', row.id),
          diff_hunk: row.diffHunk ?? '',
          path: row.path,
          commit_id: row.commitSha,
          original_commit_id: row.commitSha,
          ...(row.inReplyToNumericId !== null && {
            in_reply_to_id: row.inReplyToNumericId,
          }),
          user: context.users.get(row.authorLogin) ?? null,
          body: row.body,
          created_at: row.createdAt,
          updated_at: row.updatedAt,
          html_url: htmlUrl,
          pull_request_url: pullUrl,
          author_association: authorAssociation(row.authorLogin, context),
          _links: {
            self: { href: url },
            html: { href: htmlUrl },
            pull_request: { href: pullUrl },
          },
          start_line: row.startLine,
          original_start_line: row.startLine,
          // Ghost leaves `startSide` empty when a range starts on `side`; GitHub names it on every range.
          start_side:
            row.startLine === null
              ? null
              : (row.startSide ?? row.side) === 'deletions'
                ? 'LEFT'
                : 'RIGHT',
          line: row.line,
          original_line: row.line,
          side: row.side === 'deletions' ? 'LEFT' : 'RIGHT',
          subject_type: 'line',
        };
      }),
    };
  }
}
