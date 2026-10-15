import type { Database } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';

import { DATABASE } from '../../../database/database.module.js';
import {
  GithubNotFoundError,
  UnprocessableError,
} from '../../../lib/github/github.errors.js';
import { reviewsOf } from '../../../lib/github/node-lookup.js';
import { pageOf, RestPage, toReviewRest } from '../../../lib/github/rest.js';
import {
  type PullRequestRef,
  PullRequestsService,
} from '../../../resources/pull-requests/pull-requests.service.js';
import { ReviewsService } from '../../../resources/pull-requests/reviews.service.js';
import type {
  GithubRepositoryTarget,
  GithubViewer,
} from '../../auth/github-request.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import type { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import { GithubIssuesService } from '../issues/issues.service.js';
import type {
  GithubCreateReviewDTO,
  GithubDraftReviewCommentDTO,
  GithubSubmitReviewDTO,
  ReviewEvent,
} from './dto/review-comment.dto.js';

const SIDE = { LEFT: 'deletions', RIGHT: 'additions' } as const;

const STATE = {
  COMMENT: 'commented',
  APPROVE: 'approved',
  REQUEST_CHANGES: 'changes_requested',
} as const;

type ReviewRow = Awaited<ReturnType<typeof reviewsOf>>[number];

/** GitHub's REST pull request reviews over ReviewsService, by GitHub's integer ids. A pending review is its author's alone. */
@Injectable()
export class GithubReviewsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly github: GithubIssuesService,
    private readonly pulls: PullRequestsService,
    private readonly reviews: ReviewsService,
  ) {}

  async list(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    query: GithubPageQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const reviews = await this.rest(repository, viewer, number);
    return new RestPage(
      reviews.slice(page.offset, page.offset + page.perPage),
      page,
      reviews.length,
    );
  }

  async get(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    reviewId: number,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    return this.byNumericId(repository, viewer, number, reviewId);
  }

  async create(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    body: GithubCreateReviewDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/pulls/:number/reviews',
    );
    const review = await this.submit(
      {
        ...this.github.ref(repository, signedIn),
        requesterId: signedIn.userId,
        number,
      },
      {
        event: body.event,
        body: body.body,
        commitSha: body.commit_id,
        comments: body.comments ?? [],
      },
    );
    const [rest] = await this.rest(
      repository,
      signedIn,
      number,
      (row) => row.id === review.id,
    );
    return rest!;
  }

  async submitPending(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    reviewId: number,
    body: GithubSubmitReviewDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/pulls/:number/reviews/:review_id/events',
    );
    const pending = await this.pending(repository, signedIn, number, reviewId);
    await this.submit(
      {
        ...this.github.ref(repository, signedIn),
        requesterId: signedIn.userId,
        number,
      },
      {
        event: body.event,
        body: body.body,
        commitSha: pending.commit_id,
        comments: [],
      },
    );
    return this.byNumericId(repository, signedIn, number, reviewId);
  }

  async deletePending(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    reviewId: number,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'DELETE /repos/:owner/:repo/pulls/:number/reviews/:review_id',
    );
    const pending = await this.pending(repository, signedIn, number, reviewId);
    await this.reviews.discardPendingReview({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      number,
    });
    return pending;
  }

  /** Submits a review, or without `event` starts a pending one; `separate` leaves a pending review alone, as GitHub's single line comment does. */
  submit(
    ref: PullRequestRef & { requesterId: string },
    review: {
      event: ReviewEvent | undefined;
      body?: string;
      commitSha?: string;
      separate?: boolean;
      comments: GithubDraftReviewCommentDTO[];
    },
  ) {
    const comments = review.comments.map((draft) => ({
      path: draft.path,
      body: draft.body,
      line: draft.line,
      side: SIDE[draft.side ?? 'RIGHT'],
      startLine: draft.start_line,
      startSide: draft.start_side && SIDE[draft.start_side],
    }));
    if (review.event === undefined) {
      return this.reviews.startPendingReview({
        ...ref,
        body: review.body,
        commitSha: review.commitSha,
        comments,
      });
    }
    return this.reviews.submitReview({
      ...ref,
      commitSha: review.commitSha,
      separate: review.separate,
      body: { state: STATE[review.event], body: review.body, comments },
    });
  }

  private async byNumericId(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    number: number,
    reviewId: number,
  ) {
    const [review] = await this.rest(
      repository,
      viewer,
      number,
      (row) => row.numericId === reviewId,
    );
    if (!review) throw new GithubNotFoundError();
    return review;
  }

  /** The viewer's own pending review by its integer id; a submitted one is refused, as GitHub refuses to submit or delete it. */
  private async pending(
    repository: RepositoryNode,
    viewer: GithubViewer,
    number: number,
    reviewId: number,
  ) {
    const review = await this.byNumericId(repository, viewer, number, reviewId);
    if (review.state !== 'PENDING')
      throw new UnprocessableError('This review has already been submitted');
    return review;
  }

  /** A pull request's reviews that `which` keeps, oldest first, the viewer's pending one last. */
  private async rest(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    number: number,
    which: (row: ReviewRow) => boolean = () => true,
  ) {
    const { pullRequest } = await this.pulls.load({
      ...this.github.ref(repository, viewer),
      number,
    });
    const rows = (
      await reviewsOf(this.db, [pullRequest.id], viewer?.userId)
    ).filter(which);
    const context = await this.github.context(repository, {
      logins: rows.map((row) => row.authorLogin),
      labels: [],
    });
    return rows.map((row) => toReviewRest(row, number, context));
  }
}
