import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Session,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalAuth, type UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import {
  ComparePatchQueryDTO,
  CompareQueryDTO,
  CompareResponseDTO,
} from './dto/compare.dto.js';
import {
  CreatePullRequestRequestDTO,
  UpdatePullRequestRequestDTO,
} from './dto/create-pull-request.dto.js';
import {
  CreatePullRequestCommentRequestDTO,
  GetPullRequestCommentsResponseDTO,
  PullRequestCommentDTO,
} from './dto/pull-request-comment.dto.js';
import {
  GetPullRequestsQueryDTO,
  GetPullRequestsResponseDTO,
  PullRequestDetailDTO,
  PullRequestDTO,
} from './dto/pull-request.dto.js';
import {
  GetPullRequestCommitsQueryDTO,
  GetPullRequestCommitsResponseDTO,
  GetPullRequestFilesResponseDTO,
  GetPullRequestPatchQueryDTO,
  MergePullRequestRequestDTO,
  MergePullRequestResponseDTO,
} from './dto/pull-request-changes.dto.js';
import { PullRequestsService } from './pull-requests.service.js';

@Controller('repositories/:username/:repo/pulls')
@ApiTags('Pull requests')
export class PullRequestsController {
  constructor(private readonly pullRequests: PullRequestsService) {}

  @Post()
  @ApiOperation({ summary: 'Open a pull request' })
  @ApiCreatedResponse({ type: PullRequestDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  createPullRequest(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Body() body: CreatePullRequestRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.createPullRequest({
      username,
      repo,
      requesterId: session.user.id,
      body,
    });
  }

  @Get()
  @OptionalAuth()
  @ApiOperation({ summary: 'List pull requests' })
  @ApiOkResponse({ type: GetPullRequestsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getPullRequests(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Query() query: GetPullRequestsQueryDTO,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.getPullRequests({
      username,
      repo,
      requesterId: session?.user?.id,
      query,
    });
  }

  @Get('compare/patch')
  @ApiOperation({ summary: 'The patch two branches would open a request with' })
  @ApiOkResponse({ schema: { type: 'string' } })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async comparePatch(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Query() query: ComparePatchQueryDTO,
    @Session() session: UserSession,
  ) {
    return new StreamableFile(
      await this.pullRequests.compareStreamPatch({
        username,
        repo,
        requesterId: session.user.id,
        base: query.base,
        head: query.head,
        path: query.path,
      }),
      { type: 'text/plain; charset=utf-8' },
    );
  }

  @Get('compare')
  @ApiOperation({ summary: 'The files two branches would open a request with' })
  @ApiOkResponse({ type: CompareResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  compare(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Query() query: CompareQueryDTO,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.compare({
      username,
      repo,
      requesterId: session.user.id,
      base: query.base,
      head: query.head,
    });
  }

  @Get(':number')
  @OptionalAuth()
  @ApiOperation({ summary: 'Get a pull request' })
  @ApiOkResponse({ type: PullRequestDetailDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getPullRequest(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.getPullRequest({
      username,
      repo,
      number,
      requesterId: session?.user?.id,
    });
  }

  @Get(':number/commits')
  @OptionalAuth()
  @ApiOperation({ summary: 'Commits a pull request adds' })
  @ApiOkResponse({ type: GetPullRequestCommitsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getCommits(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Query() query: GetPullRequestCommitsQueryDTO,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.getCommits({
      username,
      repo,
      number,
      requesterId: session?.user?.id,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  @Get(':number/files')
  @OptionalAuth()
  @ApiOperation({ summary: 'Paths a pull request changes' })
  @ApiOkResponse({ type: GetPullRequestFilesResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getFiles(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.getFiles({
      username,
      repo,
      number,
      requesterId: session?.user?.id,
    });
  }

  @Get(':number/patch')
  @OptionalAuth()
  @ApiOperation({ summary: 'The patch itself, as text' })
  @ApiOkResponse({ schema: { type: 'string' } })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async getPatch(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Query() query: GetPullRequestPatchQueryDTO,
    @Session() session: UserSession,
  ) {
    return new StreamableFile(
      await this.pullRequests.streamPatch({
        username,
        repo,
        number,
        requesterId: session?.user?.id,
        path: query.path,
      }),
      { type: 'text/plain; charset=utf-8' },
    );
  }

  @Get(':number/comments')
  @OptionalAuth()
  @ApiOperation({ summary: 'Comments on a pull request' })
  @ApiOkResponse({ type: GetPullRequestCommentsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getComments(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.getComments({
      username,
      repo,
      number,
      requesterId: session?.user?.id,
    });
  }

  @Post(':number/comments')
  @ApiOperation({ summary: 'Comment on a pull request' })
  @ApiCreatedResponse({ type: PullRequestCommentDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  createComment(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: CreatePullRequestCommentRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.createComment({
      username,
      repo,
      number,
      requesterId: session.user.id,
      body: body.body,
    });
  }

  @Post(':number/merge')
  @ApiOperation({ summary: 'Merge a pull request into its base branch' })
  @ApiOkResponse({ type: MergePullRequestResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  mergePullRequest(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: MergePullRequestRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.mergePullRequest({
      username,
      repo,
      number,
      requesterId: session.user.id,
      title: body.title,
    });
  }

  @Patch(':number')
  @ApiOperation({ summary: 'Edit a pull request title or description' })
  @ApiOkResponse({ type: PullRequestDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  updatePullRequest(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() body: UpdatePullRequestRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.updatePullRequest({
      username,
      repo,
      number,
      requesterId: session.user.id,
      body,
    });
  }

  @Patch(':number/close')
  @ApiOperation({ summary: 'Close a pull request without merging' })
  @ApiOkResponse({ type: PullRequestDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  closePullRequest(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.closePullRequest({
      username,
      repo,
      number,
      requesterId: session.user.id,
    });
  }
}
