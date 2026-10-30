import { type Database, schema } from '@ghost/db';
import path from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import {
  and,
  eq,
  inArray,
  isNotNull,
  isNull,
  notExists,
  sql,
} from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { isTextBlob, readBlob } from '../../lib/git/blob/read-blob.js';
import { fileHunks, type Hunk, mergeBase } from '../../lib/git/diff/diff.js';
import { publishEvent } from '../../lib/events/events.js';
import { packRange } from '../../lib/git/merge/merge.js';
import { fileBody } from '../../lib/git/protocol/git-request-body.js';
import { replaceFile } from '../../lib/git/tree/replace-file.js';
import { diffHunkFor } from '../../lib/pull-requests/diff-hunk.js';
import { currentViaAppId, viaAppOf } from '../../lib/apps/via-app.js';
import { selectReviews } from '../../lib/pull-requests/reviews.js';
import {
  applySuggestion,
  extractSuggestion,
} from '../../lib/pull-requests/suggestion.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { RuleSuitesService } from '../../services/rulesets/rule-suites.service.js';
import { RulesetVerdictsService } from '../../services/rulesets/ruleset-verdicts.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { CommitSigningService } from '../../services/gpg/commit-signing.service.js';
import { IssueReferencesService } from '../../services/issues/issue-references.service.js';
import { UsersService } from '../../services/users/users.service.js';
import { isoTimestamp } from '../../lib/db/sql.js';
import type {
  CreateReviewRequestDTO,
  ReviewCommentRequestDTO,
} from './dto/pull-request-review.dto.js';
import {
  EmptyReviewError,
  InvalidLineRangeError,
  OwnPullRequestReviewError,
  PendingReviewExistsError,
  PendingReviewReplyError,
  PullRequestNotOpenError,
  ReviewCommentNotFoundError,
  ReviewCommitNotInPullRequestError,
  ReviewLineNotInDiffError,
  ReviewNotDismissableError,
  ReviewNotFoundError,
  SuggestionNotApplicableError,
  SuggestionOutdatedError,
} from '../../lib/pull-requests/pull-requests.errors.js';
import { NotCommentAuthorError } from '../../lib/issues/issues.errors.js';
import {
  type PullRequestRef,
  PullRequestsService,
} from './pull-requests.service.js';
import { ReviewRequestsService } from './review-requests.service.js';
import { touchIssue } from '../../lib/issues/touch-issue.js';
import { withTempDir } from '../../lib/temp-dir.js';

type Opened = Awaited<ReturnType<PullRequestsService['open']>>;
type Loaded = Awaited<ReturnType<PullRequestsService['load']>>;

const replyColumns = {
  id: schema.pullRequestReviewComment.id,
  body: schema.pullRequestReviewComment.body,
  viaApp: viaAppOf(schema.pullRequestReviewComment.viaAppId),
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
    private readonly reviewRequests: ReviewRequestsService,
    private readonly users: UsersService,
    private readonly pushTransaction: PushTransactionService,
    private readonly signing: CommitSigningService,
    private readonly verdicts: RulesetVerdictsService,
    private readonly ruleSuites: RuleSuitesService,
  ) {}

  /** Submits the requester's pending review, or a new one, together with any further line comments. `separate` leaves the pending review alone and submits a new one; `commitSha` reviews an earlier commit of the request instead of its head. */
  async submitReview(
    params: PullRequestRef & {
      requesterId: string;
      body: CreateReviewRequestDTO;
      separate?: boolean;
      commitSha?: string;
    },
  ) {
    const git = await this.openForReview(params);
    const { pullRequest, base } = git;
    const { state, comments = [] } = params.body;
    if (state !== 'commented' && pullRequest.authorId === params.requesterId) {
      throw new OwnPullRequestReviewError();
    }
    const commit = await this.reviewedCommit(git, params.commitSha);
    const located = await this.locateInDiff(git, commit, comments);

    const [pending] = params.separate
      ? []
      : await this.db
          .select({
            id: schema.pullRequestReview.id,
            body: schema.pullRequestReview.body,
            comments: sql<number>`(select count(*)::int from ${schema.pullRequestReviewComment} where ${schema.pullRequestReviewComment.reviewId} = ${schema.pullRequestReview.id})`,
          })
          .from(schema.pullRequestReview)
          .where(pendingOf(pullRequest.id, params.requesterId));
    const body = params.body.body?.trim() || pending?.body || null;
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
              commitSha: commit.sha,
              baseSha: git.baseSha,
              submittedAt: new Date(),
            })
            .where(eq(schema.pullRequestReview.id, pending.id))
            .returning({ id: schema.pullRequestReview.id })
        : await tx
            .insert(schema.pullRequestReview)
            .values({
              pullRequestId: pullRequest.id,
              authorId: params.requesterId,
              viaAppId: currentViaAppId(),
              state,
              body,
              commitSha: commit.sha,
              baseSha: git.baseSha,
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
            viaAppId: currentViaAppId(),
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

      // The author is never requested, so their review answers nothing, not even their teams' requests.
      if (params.requesterId !== pullRequest.authorId) {
        await this.reviewRequests.clearForReview(tx, {
          pullRequestId: pullRequest.id,
          reviewerId: params.requesterId,
          reviewId: review.id,
        });
      }
      await publishEvent(tx, {
        type: 'pull_request.reviewed',
        repositoryId: base.id,
        actorId: params.requesterId,
        payload: { issueId: pullRequest.issueId, reviewId: review.id },
      });
      await touchIssue(tx, pullRequest.issueId);
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
    const commit = await this.reviewedCommit(git, undefined);
    const [located] = await this.locateInDiff(git, commit, [params.body]);

    await this.db.transaction(async (tx) => {
      await tx
        .insert(schema.pullRequestReview)
        .values({
          pullRequestId: git.pullRequest.id,
          authorId: params.requesterId,
          viaAppId: currentViaAppId(),
          commitSha: commit.sha,
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
        viaAppId: currentViaAppId(),
      });
    });

    return this.getPendingReview(params);
  }

  /** Starts the requester's pending review with a summary and line comments, as GitHub's review without an event does; refuses when one is already pending. */
  async startPendingReview(
    params: PullRequestRef & {
      requesterId: string;
      body?: string;
      comments: ReviewCommentRequestDTO[];
      commitSha?: string;
    },
  ) {
    const git = await this.openForReview(params);
    const commit = await this.reviewedCommit(git, params.commitSha);
    const located = await this.locateInDiff(git, commit, params.comments);

    const reviewId = await this.db.transaction(async (tx) => {
      const [review] = await tx
        .insert(schema.pullRequestReview)
        .values({
          pullRequestId: git.pullRequest.id,
          authorId: params.requesterId,
          viaAppId: currentViaAppId(),
          body: params.body?.trim() || null,
          commitSha: commit.sha,
        })
        .onConflictDoNothing()
        .returning({ id: schema.pullRequestReview.id });
      if (!review) throw new PendingReviewExistsError();
      if (located.length > 0) {
        await tx.insert(schema.pullRequestReviewComment).values(
          located.map((comment) => ({
            ...comment,
            pullRequestId: git.pullRequest.id,
            reviewId: review.id,
            authorId: params.requesterId,
            viaAppId: currentViaAppId(),
          })),
        );
      }
      return review.id;
    });
    return this.findReview(reviewId);
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
      await touchIssue(tx, loaded.pullRequest.issueId);
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

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.pullRequestReview)
        .set({
          dismissedById: params.requesterId,
          dismissalMessage: params.message.trim(),
        })
        .where(eq(schema.pullRequestReview.id, review.id));
      await publishEvent(tx, {
        type: 'pull_request.review_dismissed',
        repositoryId: loaded.base.id,
        actorId: params.requesterId,
        payload: { issueId: loaded.pullRequest.issueId, reviewId: review.id },
      });
    });
    return this.findReview(review.id);
  }

  /** Replies join the thread of the comment replied to, even when that comment is itself a reply. Each is a comment-only review of its own, as on GitHub; the conversation shows it in its thread, not as a review. */
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
      const [review] = await tx
        .insert(schema.pullRequestReview)
        .values({
          pullRequestId: loaded.pullRequest.id,
          authorId: params.requesterId,
          viaAppId: currentViaAppId(),
          state: 'commented',
          commitSha: comment.commitSha,
          submittedAt: new Date(),
        })
        .returning({ id: schema.pullRequestReview.id });
      if (!review) throw new Error('Review insert returned no rows');
      const [row] = await tx
        .insert(schema.pullRequestReviewComment)
        .values({
          pullRequestId: loaded.pullRequest.id,
          reviewId: review.id,
          inReplyToId: comment.inReplyToId ?? comment.id,
          authorId: params.requesterId,
          viaAppId: currentViaAppId(),
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
      await publishEvent(tx, {
        type: 'pull_request.review_commented',
        repositoryId: loaded.base.id,
        actorId: params.requesterId,
        payload: { issueId: loaded.pullRequest.issueId, commentId: row.id },
      });

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
      await touchIssue(tx, loaded.pullRequest.issueId);
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

  /** Deleting a thread's first comment deletes its replies. Comment-only reviews left with nothing to say, a reply's own among them, go with them. */
  async deleteComment(
    params: PullRequestRef & { requesterId: string; commentId: string },
  ) {
    const loaded = await this.pullRequests.load(params);
    const comment = await this.visibleComment(loaded, params);
    if (comment.authorId !== params.requesterId) {
      await this.access.authorize({ ...params, operation: 'write' });
    }

    await this.db.transaction(async (tx) => {
      const replies = await tx
        .select({
          id: schema.pullRequestReviewComment.id,
          reviewId: schema.pullRequestReviewComment.reviewId,
        })
        .from(schema.pullRequestReviewComment)
        .where(eq(schema.pullRequestReviewComment.inReplyToId, comment.id));
      for (const { id } of [comment, ...replies]) {
        await this.references.forget(tx, 'comment', id);
      }

      await tx
        .delete(schema.pullRequestReviewComment)
        .where(eq(schema.pullRequestReviewComment.id, comment.id));
      await tx.delete(schema.pullRequestReview).where(
        and(
          inArray(
            schema.pullRequestReview.id,
            [comment, ...replies].map((deleted) => deleted.reviewId),
          ),
          eq(schema.pullRequestReview.state, 'commented'),
          isNull(schema.pullRequestReview.body),
          notExists(
            tx
              .select({ id: schema.pullRequestReviewComment.id })
              .from(schema.pullRequestReviewComment)
              .where(
                eq(
                  schema.pullRequestReviewComment.reviewId,
                  schema.pullRequestReview.id,
                ),
              ),
          ),
        ),
      );
      await touchIssue(tx, loaded.pullRequest.issueId);
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
    const head = await this.access.authorizeById({
      repositoryId: headRepositoryId,
      requesterId: params.requesterId,
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
      sign: this.signing.signer,
    });

    const transitions = [
      {
        ref: `refs/heads/${pullRequest.headRef}`,
        oldOid: Buffer.from(git.headSha, 'hex'),
        newOid: Buffer.from(commitSha, 'hex'),
      },
    ];
    const verdict = await this.verdicts.judge({
      repository: head,
      gitDir: git.headDirectory,
      userId: params.requesterId,
      write: 'push',
      transitions,
      facts: new Map([
        [
          transitions[0].ref,
          { isFastForward: true, introducesMergeCommit: false },
        ],
      ]),
    });
    await withTempDir('ghost-suggestion-', async (directory) => {
      const pack = await packRange({
        gitDir: git.headDirectory,
        include: [commitSha],
        exclude: [git.headSha],
        prefix: path.join(directory, 'suggestion'),
      });
      await this.ruleSuites.attempt(
        {
          repositoryId: headRepositoryId,
          actorId: params.requesterId,
          verdict,
        },
        () =>
          this.pushTransaction.commitPush({
            repoId: headRepositoryId,
            transitions,
            body: fileBody(pack.path, pack.size),
            packOffset: 0,
            actor: { userId: params.requesterId, verdict },
          }),
      );
    });

    await this.pullRequests.afterPush({
      repositoryId: headRepositoryId,
      transitions,
      pushedBy: params.requesterId,
    });
    return { commitSha };
  }

  private async openForReview(params: PullRequestRef) {
    const git = await this.pullRequests.open(params);
    if (git.pullRequest.state !== 'open') {
      throw new PullRequestNotOpenError(git.pullRequest.state);
    }
    return git;
  }

  /** The commit a review is made on and the merge base its diff starts from: the head, unless `commitSha` names an earlier commit of the request. A commit a force-push dropped no longer reaches the head, so it is refused like one that was never part of the request. */
  private async reviewedCommit(git: Opened, commitSha: string | undefined) {
    if (commitSha === undefined || commitSha === git.headSha) {
      return { sha: git.headSha, from: git.mergeBase ?? git.baseSha };
    }
    const range = { gitDir: git.baseDirectory, alternates: git.alternates };
    const [reached, from] = await Promise.all([
      mergeBase({ ...range, a: commitSha, b: git.headSha }),
      mergeBase({ ...range, a: git.baseSha, b: commitSha }),
    ]);
    if (reached !== commitSha || from === null || from === commitSha) {
      throw new ReviewCommitNotInPullRequestError(commitSha);
    }
    return { sha: commitSha, from };
  }

  /** Every comment must sit on a line the diff shows, on the side it names; each comes back with the rows of the diff it points at and the commit it was made on. */
  private async locateInDiff(
    git: Opened,
    commit: { sha: string; from: string },
    comments: ReviewCommentRequestDTO[],
  ) {
    const byPath = new Map<string, Hunk[]>();
    const located = [];
    for (const comment of comments) {
      if (!byPath.has(comment.path)) {
        byPath.set(
          comment.path,
          await fileHunks({
            gitDir: git.baseDirectory,
            alternates: git.alternates,
            from: commit.from,
            to: commit.sha,
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
      located.push({
        ...comment,
        commitSha: commit.sha,
        diffHunk: diffHunkFor(hunks, comment),
      });
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
        pending: sql<boolean>`${schema.pullRequestReview.submittedAt} is null`,
      })
      .from(schema.pullRequestReviewComment)
      .innerJoin(
        schema.user,
        eq(schema.user.id, schema.pullRequestReviewComment.authorId),
      )
      .innerJoin(
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
}

function pendingOf(pullRequestId: string, authorId: string) {
  return and(
    eq(schema.pullRequestReview.pullRequestId, pullRequestId),
    eq(schema.pullRequestReview.authorId, authorId),
    isNull(schema.pullRequestReview.submittedAt),
  );
}
