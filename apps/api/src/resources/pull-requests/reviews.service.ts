import { type Database, schema } from '@ghost/db';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNotNull, isNull, notExists, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { isTextBlob, readBlob } from '../../lib/git/blob/read-blob.js';
import { fileHunks, type Hunk } from '../../lib/git/diff/diff.js';
import { packRange } from '../../lib/git/merge/merge.js';
import { fileBody } from '../../lib/git/protocol/git-request-body.js';
import { replaceFile } from '../../lib/git/tree/replace-file.js';
import type { Executor } from '../../lib/issues/close-issue.js';
import { diffHunkFor } from '../../lib/pull-requests/diff-hunk.js';
import { selectReviews } from '../../lib/pull-requests/reviews.js';
import {
  applySuggestion,
  extractSuggestion,
} from '../../lib/pull-requests/suggestion.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { IssueReferencesService } from '../../services/issues/issue-references.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { isoTimestamp } from '../../utils/index.js';
import type {
  CreateReviewRequestDTO,
  ReviewCommentRequestDTO,
} from './dto/pull-request-review.dto.js';
import {
  EmptyReviewError,
  InvalidLineRangeError,
  OwnPullRequestReviewError,
  PendingReviewReplyError,
  PullRequestNotOpenError,
  ReviewCommentNotFoundError,
  ReviewLineNotInDiffError,
  ReviewNotDismissableError,
  ReviewNotFoundError,
  SuggestionNotApplicableError,
  SuggestionOutdatedError,
} from './pull-requests.errors.js';
import { NotCommentAuthorError } from '../issues/issues.errors.js';
import {
  type PullRequestRef,
  PullRequestsService,
} from './pull-requests.service.js';

type Opened = Awaited<ReturnType<PullRequestsService['open']>>;
type Loaded = Awaited<ReturnType<PullRequestsService['load']>>;

const replyColumns = {
  id: schema.pullRequestReviewComment.id,
  body: schema.pullRequestReviewComment.body,
  createdAt: isoTimestamp(schema.pullRequestReviewComment.createdAt),
  updatedAt: isoTimestamp(schema.pullRequestReviewComment.updatedAt),
};

/** Reviews, their line comments and the replies under them. Anyone who can read a request may review it and reply, the same bar as commenting; editing someone else's words takes `write`. */
@Injectable()
export class ReviewsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly references: IssueReferencesService,
    private readonly pullRequests: PullRequestsService,
    private readonly users: UsersService,
    private readonly pushTransaction: PushTransactionService,
  ) {}

  /** Submits the requester's pending review, or a new one, together with any further line comments. */
  async submitReview(
    params: PullRequestRef & {
      requesterId: string;
      body: CreateReviewRequestDTO;
    },
  ) {
    const git = await this.openForReview(params);
    const { pullRequest, base } = git;
    const { state, comments = [] } = params.body;
    const body = params.body.body?.trim() || null;
    if (state !== 'commented' && pullRequest.authorId === params.requesterId) {
      throw new OwnPullRequestReviewError();
    }
    const located = await this.locateInDiff(git, comments);

    const [pending] = await this.db
      .select({
        id: schema.pullRequestReview.id,
        comments: sql<number>`(select count(*)::int from ${schema.pullRequestReviewComment} where ${schema.pullRequestReviewComment.reviewId} = ${schema.pullRequestReview.id})`,
      })
      .from(schema.pullRequestReview)
      .where(pendingOf(pullRequest.id, params.requesterId));
    if (
      state === 'commented' &&
      !body &&
      comments.length === 0 &&
      !pending?.comments
    ) {
      throw new EmptyReviewError();
    }

    const reviewId = await this.db.transaction(async (tx) => {
      const [review] = pending
        ? await tx
            .update(schema.pullRequestReview)
            .set({
              state,
              body,
              commitSha: git.headSha,
              submittedAt: new Date(),
            })
            .where(eq(schema.pullRequestReview.id, pending.id))
            .returning({ id: schema.pullRequestReview.id })
        : await tx
            .insert(schema.pullRequestReview)
            .values({
              pullRequestId: pullRequest.id,
              authorId: params.requesterId,
              state,
              body,
              commitSha: git.headSha,
              submittedAt: new Date(),
            })
            .returning({ id: schema.pullRequestReview.id });
      if (!review) throw new Error('Review write returned no rows');

      if (located.length > 0) {
        await tx.insert(schema.pullRequestReviewComment).values(
          located.map((comment) => ({
            ...comment,
            pullRequestId: pullRequest.id,
            reviewId: review.id,
            authorId: params.requesterId,
            commitSha: git.headSha,
          })),
        );
      }

      // Pending comments were invisible, so what they mention is recorded only now.
      const source = {
        repository: base,
        issueId: pullRequest.issueId,
        actorId: params.requesterId,
      };
      await this.references.record(
        tx,
        { type: 'comment', id: review.id, ...source },
        body,
      );
      const written = await tx
        .select({
          id: schema.pullRequestReviewComment.id,
          body: schema.pullRequestReviewComment.body,
        })
        .from(schema.pullRequestReviewComment)
        .where(eq(schema.pullRequestReviewComment.reviewId, review.id));
      for (const comment of written) {
        await this.references.record(
          tx,
          { type: 'comment', id: comment.id, ...source },
          comment.body,
        );
      }

      await touch(tx, pullRequest.issueId);
      return review.id;
    });

    return this.findReview(reviewId);
  }

  /** Adds a line comment to the requester's pending review, starting one on the current head if there is none. */
  async addPendingComment(
    params: PullRequestRef & {
      requesterId: string;
      body: ReviewCommentRequestDTO;
    },
  ) {
    const git = await this.openForReview(params);
    const [located] = await this.locateInDiff(git, [params.body]);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(schema.pullRequestReview)
        .values({
          pullRequestId: git.pullRequest.id,
          authorId: params.requesterId,
          commitSha: git.headSha,
        })
        .onConflictDoNothing();
      const [pending] = await tx
        .select({ id: schema.pullRequestReview.id })
        .from(schema.pullRequestReview)
        .where(pendingOf(git.pullRequest.id, params.requesterId));
      if (!pending) throw new Error('Pending review vanished mid-transaction');

      await tx.insert(schema.pullRequestReviewComment).values({
        ...located,
        pullRequestId: git.pullRequest.id,
        reviewId: pending.id,
        authorId: params.requesterId,
        commitSha: git.headSha,
      });
    });

    return this.getPendingReview(params);
  }

  async getPendingReview(params: PullRequestRef & { requesterId: string }) {
    const { pullRequest } = await this.pullRequests.load(params);
    const [review] = await selectReviews(
      this.db,
      pendingOf(pullRequest.id, params.requesterId),
    );
    return { review: review ?? null };
  }

  async discardPendingReview(params: PullRequestRef & { requesterId: string }) {
    const { pullRequest } = await this.pullRequests.load(params);
    await this.db
      .delete(schema.pullRequestReview)
      .where(pendingOf(pullRequest.id, params.requesterId));
    return { deleted: true };
  }

  async updateReview(
    params: PullRequestRef & {
      requesterId: string;
      reviewId: string;
      body: string | null;
    },
  ) {
    const loaded = await this.pullRequests.load(params);
    const review = await this.submittedReview(loaded, params.reviewId);
    if (review.authorId !== params.requesterId) {
      throw new NotCommentAuthorError();
    }

    const body = params.body?.trim() || null;
    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.pullRequestReview)
        .set({ body })
        .where(eq(schema.pullRequestReview.id, review.id));
      await this.references.record(
        tx,
        {
          type: 'comment',
          id: review.id,
          repository: loaded.base,
          issueId: loaded.pullRequest.issueId,
          actorId: review.authorId,
        },
        body,
      );
      await touch(tx, loaded.pullRequest.issueId);
    });
    return this.findReview(review.id);
  }

  async dismissReview(
    params: PullRequestRef & {
      requesterId: string;
      reviewId: string;
      message: string;
    },
  ) {
    const loaded = await this.pullRequests.load({
      ...params,
      operation: 'write',
    });
    const review = await this.submittedReview(loaded, params.reviewId);
    if (review.state === 'commented' || review.dismissalMessage !== null) {
      throw new ReviewNotDismissableError();
    }

    await this.db
      .update(schema.pullRequestReview)
      .set({
        dismissedById: params.requesterId,
        dismissalMessage: params.message.trim(),
      })
      .where(eq(schema.pullRequestReview.id, review.id));
    return this.findReview(review.id);
  }

  /** Replies join the thread of the comment replied to, even when that comment is itself a reply. */
  async replyToComment(
    params: PullRequestRef & {
      requesterId: string;
      commentId: string;
      body: string;
    },
  ) {
    const loaded = await this.pullRequests.load(params);
    const comment = await this.visibleComment(loaded, params);
    if (comment.pending) throw new PendingReviewReplyError();

    const reply = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.pullRequestReviewComment)
        .values({
          pullRequestId: loaded.pullRequest.id,
          inReplyToId: comment.inReplyToId ?? comment.id,
          authorId: params.requesterId,
          path: comment.path,
          side: comment.side,
          line: comment.line,
          startSide: comment.startSide,
          startLine: comment.startLine,
          commitSha: comment.commitSha,
          body: params.body,
        })
        .returning(replyColumns);
      if (!row) throw new Error('Reply insert returned no rows');

      await this.references.record(
        tx,
        {
          type: 'comment',
          id: row.id,
          repository: loaded.base,
          issueId: loaded.pullRequest.issueId,
          actorId: params.requesterId,
        },
        params.body,
      );
      await touch(tx, loaded.pullRequest.issueId);
      return row;
    });

    const [author] = await this.db
      .select({
        username: sql<string>`coalesce(${schema.user.username}, '')`,
        image: schema.user.image,
      })
      .from(schema.user)
      .where(eq(schema.user.id, params.requesterId));
    return {
      ...reply,
      authorUsername: author?.username ?? '',
      authorImage: author?.image ?? null,
    };
  }

  async updateComment(
    params: PullRequestRef & {
      requesterId: string;
      commentId: string;
      body: string;
    },
  ) {
    const loaded = await this.pullRequests.load(params);
    const comment = await this.visibleComment(loaded, params);
    if (comment.authorId !== params.requesterId) {
      throw new NotCommentAuthorError();
    }

    const updated = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(schema.pullRequestReviewComment)
        .set({ body: params.body })
        .where(eq(schema.pullRequestReviewComment.id, comment.id))
        .returning(replyColumns);
      if (!row) throw new ReviewCommentNotFoundError();

      // A pending comment's mentions are recorded when its review is submitted.
      if (!comment.pending) {
        await this.references.record(
          tx,
          {
            type: 'comment',
            id: comment.id,
            repository: loaded.base,
            issueId: loaded.pullRequest.issueId,
            actorId: comment.authorId,
          },
          params.body,
        );
      }
      return row;
    });
    return {
      ...updated,
      authorUsername: comment.authorUsername,
      authorImage: comment.authorImage,
    };
  }

  /** Deleting a thread's first comment deletes its replies. A comment-only review left with nothing to say goes with it. */
  async deleteComment(
    params: PullRequestRef & { requesterId: string; commentId: string },
  ) {
    const loaded = await this.pullRequests.load(params);
    const comment = await this.visibleComment(loaded, params);
    if (comment.authorId !== params.requesterId) {
      await this.authorizeWrite(params);
    }

    await this.db.transaction(async (tx) => {
      const replies = await tx
        .select({ id: schema.pullRequestReviewComment.id })
        .from(schema.pullRequestReviewComment)
        .where(eq(schema.pullRequestReviewComment.inReplyToId, comment.id));
      for (const { id } of [comment, ...replies]) {
        await this.references.forget(tx, 'comment', id);
      }

      await tx
        .delete(schema.pullRequestReviewComment)
        .where(eq(schema.pullRequestReviewComment.id, comment.id));
      if (comment.reviewId) {
        await tx
          .delete(schema.pullRequestReview)
          .where(
            and(
              eq(schema.pullRequestReview.id, comment.reviewId),
              eq(schema.pullRequestReview.state, 'commented'),
              sql`${schema.pullRequestReview.body} is null`,
              notExists(
                tx
                  .select({ id: schema.pullRequestReviewComment.id })
                  .from(schema.pullRequestReviewComment)
                  .where(
                    eq(
                      schema.pullRequestReviewComment.reviewId,
                      comment.reviewId,
                    ),
                  ),
              ),
            ),
          );
      }
      await touch(tx, loaded.pullRequest.issueId);
    });
    return { deleted: true };
  }

  /** Commits a comment's suggestion to the head branch in place of the lines it was made on, through the head's own commit point. Takes `write` on the head repository, which for a fork is the fork. */
  async applySuggestion(
    params: PullRequestRef & { requesterId: string; commentId: string },
  ) {
    const loaded = await this.pullRequests.load(params);
    const { pullRequest, base } = loaded;
    if (pullRequest.state !== 'open') {
      throw new PullRequestNotOpenError(pullRequest.state);
    }
    const comment = await this.visibleComment(loaded, params);
    const suggestion = extractSuggestion(comment.body);
    if (comment.pending || suggestion === null) {
      throw new SuggestionNotApplicableError(
        'This comment has no submitted suggestion',
      );
    }
    if (
      comment.side !== 'additions' ||
      (comment.startSide ?? comment.side) !== 'additions'
    ) {
      throw new SuggestionNotApplicableError(
        'Only lines on the head side of the diff can be changed',
      );
    }

    // An open request always has its head: a repository heading one cannot be deleted.
    const headRepositoryId = pullRequest.headRepositoryId!;
    await this.access.authorizeById({
      repositoryId: headRepositoryId,
      actor: { userId: params.requesterId },
      operation: 'write',
    });
    const git = await this.pullRequests.openLive(
      pullRequest,
      base,
      headRepositoryId,
    );
    if (comment.commitSha !== git.headSha) throw new SuggestionOutdatedError();

    const blob = await readBlob({
      gitDir: git.headDirectory,
      ref: git.headSha,
      path: comment.path,
    });
    const content = blob?.content ?? null;
    if (!isTextBlob(content)) {
      throw new SuggestionNotApplicableError(
        'Only a text file under 1 MB can take a suggestion',
      );
    }

    const author = await this.users.getUserById(params.requesterId);
    const commitSha = await replaceFile({
      gitDir: git.headDirectory,
      parent: git.headSha,
      file: comment.path,
      content: Buffer.from(
        applySuggestion(
          content.toString('utf8'),
          comment.startLine ?? comment.line,
          comment.line,
          suggestion,
        ),
      ),
      message: `Apply suggestion from ${comment.authorUsername || 'code review'}\n`,
      author: { name: author.name, email: author.email },
    });

    const directory = await mkdtemp(path.join(tmpdir(), 'ghost-suggestion-'));
    try {
      const pack = await packRange({
        gitDir: git.headDirectory,
        include: [commitSha],
        exclude: [git.headSha],
        prefix: path.join(directory, 'suggestion'),
      });
      await this.pushTransaction.commitPush({
        repoId: headRepositoryId,
        transitions: [
          {
            ref: `refs/heads/${pullRequest.headRef}`,
            oldOid: Buffer.from(git.headSha, 'hex'),
            newOid: Buffer.from(commitSha, 'hex'),
          },
        ],
        body: fileBody(pack.path, pack.size),
        packOffset: 0,
        pushedBy: params.requesterId,
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    await this.db
      .update(schema.repository)
      .set({ lastPushedAt: new Date() })
      .where(eq(schema.repository.id, headRepositoryId));
    return { commitSha };
  }

  private async openForReview(params: PullRequestRef) {
    const git = await this.pullRequests.open(params);
    if (git.pullRequest.state !== 'open') {
      throw new PullRequestNotOpenError(git.pullRequest.state);
    }
    return git;
  }

  /** Every comment must sit on a line the diff shows, on the side it names; each comes back with the rows of the diff it points at. */
  private async locateInDiff(git: Opened, comments: ReviewCommentRequestDTO[]) {
    const byPath = new Map<string, Hunk[]>();
    const located = [];
    for (const comment of comments) {
      if (!byPath.has(comment.path)) {
        byPath.set(
          comment.path,
          await fileHunks({
            gitDir: git.baseDirectory,
            alternates: git.alternates,
            from: git.mergeBase ?? git.baseSha,
            to: git.headSha,
            path: comment.path,
          }),
        );
      }
      const hunks = byPath.get(comment.path) ?? [];
      const startSide = comment.startSide ?? comment.side;
      const startLine = comment.startLine ?? comment.line;
      const covers = (hunk: Hunk, side: typeof startSide, line: number) =>
        line >= hunk[side][0] && line <= hunk[side][1];
      const hunk = hunks.find((h) => covers(h, comment.side, comment.line));
      if (!hunk) throw new ReviewLineNotInDiffError(comment.path, comment.line);
      // A range stays inside one hunk: one spanning two would cover, and a suggestion would replace, lines the diff never showed.
      if (!covers(hunk, startSide, startLine)) {
        throw new ReviewLineNotInDiffError(comment.path, startLine);
      }
      if (startSide === comment.side && startLine > comment.line) {
        throw new InvalidLineRangeError();
      }
      located.push({ ...comment, diffHunk: diffHunkFor(hunks, comment) });
    }
    return located;
  }

  private async findReview(reviewId: string) {
    const [review] = await selectReviews(
      this.db,
      eq(schema.pullRequestReview.id, reviewId),
    );
    if (!review) throw new ReviewNotFoundError();
    return review;
  }

  private async submittedReview({ pullRequest }: Loaded, reviewId: string) {
    const [review] = await this.db
      .select()
      .from(schema.pullRequestReview)
      .where(
        and(
          eq(schema.pullRequestReview.id, reviewId),
          eq(schema.pullRequestReview.pullRequestId, pullRequest.id),
          isNotNull(schema.pullRequestReview.submittedAt),
        ),
      );
    if (!review) throw new ReviewNotFoundError();
    return review;
  }

  /** Another reviewer's pending comments do not exist as far as the requester can tell. */
  private async visibleComment(
    { pullRequest }: Loaded,
    { commentId, requesterId }: { commentId: string; requesterId: string },
  ) {
    const [comment] = await this.db
      .select({
        id: schema.pullRequestReviewComment.id,
        reviewId: schema.pullRequestReviewComment.reviewId,
        inReplyToId: schema.pullRequestReviewComment.inReplyToId,
        authorId: schema.pullRequestReviewComment.authorId,
        authorUsername: sql<string>`coalesce(${schema.user.username}, '')`,
        authorImage: schema.user.image,
        path: schema.pullRequestReviewComment.path,
        side: schema.pullRequestReviewComment.side,
        line: schema.pullRequestReviewComment.line,
        startSide: schema.pullRequestReviewComment.startSide,
        startLine: schema.pullRequestReviewComment.startLine,
        body: schema.pullRequestReviewComment.body,
        commitSha: schema.pullRequestReviewComment.commitSha,
        pending: sql<boolean>`${schema.pullRequestReview.id} is not null and ${schema.pullRequestReview.submittedAt} is null`,
      })
      .from(schema.pullRequestReviewComment)
      .innerJoin(
        schema.user,
        eq(schema.user.id, schema.pullRequestReviewComment.authorId),
      )
      .leftJoin(
        schema.pullRequestReview,
        eq(
          schema.pullRequestReview.id,
          schema.pullRequestReviewComment.reviewId,
        ),
      )
      .where(
        and(
          eq(schema.pullRequestReviewComment.id, commentId),
          eq(schema.pullRequestReviewComment.pullRequestId, pullRequest.id),
        ),
      );
    if (!comment || (comment.pending && comment.authorId !== requesterId)) {
      throw new ReviewCommentNotFoundError();
    }
    return comment;
  }

  private authorizeWrite({
    username,
    repo,
    requesterId,
  }: {
    username: string;
    repo: string;
    requesterId: string;
  }) {
    return this.access.authorize({
      username,
      repo,
      actor: { userId: requesterId },
      operation: 'write',
    });
  }
}

function pendingOf(pullRequestId: string, authorId: string) {
  return and(
    eq(schema.pullRequestReview.pullRequestId, pullRequestId),
    eq(schema.pullRequestReview.authorId, authorId),
    isNull(schema.pullRequestReview.submittedAt),
  );
}

function touch(tx: Executor, issueId: string) {
  return tx
    .update(schema.issue)
    .set({ updatedAt: new Date() })
    .where(eq(schema.issue.id, issueId));
}
