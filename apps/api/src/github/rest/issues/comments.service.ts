import { Injectable } from '@nestjs/common';

import { pageOf, RestPage } from '../../../lib/github/rest.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import type {
  GithubRepositoryTarget,
  GithubViewer,
} from '../../auth/github-request.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import type {
  GithubCommentDTO,
  GithubListCommentsQueryDTO,
} from './dto/issue.dto.js';
import { GithubIssuesService } from './issues.service.js';

/** GitHub's REST issue comments over IssuesService, by GitHub's integer comment ids. */
@Injectable()
export class GithubCommentsService {
  constructor(
    private readonly github: GithubIssuesService,
    private readonly issues: IssuesService,
  ) {}

  /** GitHub ignores `direction` without `sort`, listing oldest first. */
  async listForRepository(
    { owner, repo, viewer }: GithubRepositoryTarget,
    query: GithubListCommentsQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    return this.page(repository, viewer, query, {
      sort: query.sort ?? 'created',
      direction: query.sort ? (query.direction ?? 'desc') : 'asc',
    });
  }

  async list(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    query: GithubListCommentsQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    return this.page(repository, viewer, query, {
      number,
      sort: 'created',
      direction: 'asc',
    });
  }

  async get({ owner, repo, viewer }: GithubRepositoryTarget, id: number) {
    const repository = await this.github.readable(owner, repo, viewer);
    const comment = await this.github.commentByNumericId(repository, id);
    const [rest] = await this.github.comments(repository, [comment]);
    return rest;
  }

  async create(
    { owner, repo, viewer }: GithubRepositoryTarget,
    number: number,
    body: GithubCommentDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/issues/:number/comments',
    );
    const created = await this.issues.createComment({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      number,
      body: body.body,
    });
    const comment = await this.github.commentById(repository, created.id);
    const [rest] = await this.github.comments(repository, [comment]);
    return rest;
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
      'PATCH /repos/:owner/:repo/issues/comments/:comment_id',
    );
    const comment = await this.github.commentByNumericId(repository, id);
    const updated = await this.issues.updateComment({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      number: comment.issueNumber,
      commentId: comment.id,
      body: body.body,
    });
    const [rest] = await this.github.comments(repository, [
      { ...comment, ...updated },
    ]);
    return rest;
  }

  async delete({ owner, repo, viewer }: GithubRepositoryTarget, id: number) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'DELETE /repos/:owner/:repo/issues/comments/:comment_id',
    );
    const comment = await this.github.commentByNumericId(repository, id);
    await this.issues.deleteComment({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      number: comment.issueNumber,
      commentId: comment.id,
    });
  }

  private async page(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    query: GithubListCommentsQueryDTO,
    order: {
      number?: number;
      sort: 'created' | 'updated';
      direction: 'asc' | 'desc';
    },
  ) {
    const page = pageOf(query);
    const { comments, total } = await this.issues.getCommentPage({
      ...this.github.ref(repository, viewer),
      ...order,
      since: query.since ? new Date(query.since) : undefined,
      offset: page.offset,
      limit: page.perPage,
    });
    return new RestPage(
      await this.github.comments(repository, comments),
      page,
      total,
    );
  }
}
