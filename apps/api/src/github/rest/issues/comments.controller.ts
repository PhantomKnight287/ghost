import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';

import { pageOf } from '../../../lib/github/rest.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import {
  GithubCommentDTO,
  GithubListCommentsQueryDTO,
} from './dto/issue.dto.js';
import { GithubIssuesService } from './issues.service.js';

const ID = new ParseIntPipe({ errorHttpStatusCode: 404 });

/** Registered before IssuesController, so `issues/comments` is not read as issue number "comments". */
@Controller('v3/repos/:owner/:repo/issues')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class CommentsController {
  constructor(
    private readonly github: GithubIssuesService,
    private readonly issues: IssuesService,
  ) {}

  @Get('comments')
  @ApiOperation({
    summary: "Every comment in a repository's issues and pull requests",
  })
  async listForRepository(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: GithubListCommentsQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    // GitHub ignores `direction` without `sort`, listing oldest first.
    return this.page(repository, viewer, query, request, response, {
      sort: query.sort ?? 'created',
      direction: query.sort ? (query.direction ?? 'desc') : 'asc',
    });
  }

  @Get('comments/:comment_id')
  @ApiOperation({ summary: 'A comment by id' })
  async get(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('comment_id', ID) id: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const comment = await this.github.commentByNumericId(repository, id);
    const [rest] = await this.github.comments(repository, [comment]);
    return rest;
  }

  @Patch('comments/:comment_id')
  @ApiOperation({ summary: 'Edit a comment; only its author may' })
  async update(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('comment_id', ID) id: number,
    @Body() body: GithubCommentDTO,
    @Viewer() viewer: GithubViewer | null,
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

  @Delete('comments/:comment_id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a comment' })
  async delete(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('comment_id', ID) id: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
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

  @Get(':number/comments')
  @ApiOperation({ summary: "An issue's comments, oldest first" })
  async list(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ID) number: number,
    @Query() query: GithubListCommentsQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    return this.page(repository, viewer, query, request, response, {
      number,
      sort: 'created',
      direction: 'asc',
    });
  }

  @Post(':number/comments')
  @ApiOperation({ summary: 'Comment on an issue or pull request' })
  async create(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', ID) number: number,
    @Body() body: GithubCommentDTO,
    @Viewer() viewer: GithubViewer | null,
    @Res({ passthrough: true }) response: Response,
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
    response.setHeader('Location', rest.url);
    return rest;
  }

  private async page(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    query: GithubListCommentsQueryDTO,
    request: Request,
    response: Response,
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
    this.github.link(request, response, page, total);
    return this.github.comments(repository, comments);
  }
}
