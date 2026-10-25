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
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { SignInOptional } from '../../auth/api-key-auth.guard.js';
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
  GetPullRequestsQueryDTO,
  GetPullRequestsResponseDTO,
  GetReviewRequestsQueryDTO,
  PullRequestDetailDTO,
  PullRequestDTO,
} from './dto/pull-request.dto.js';
import {
  GetPullRequestCommitsQueryDTO,
  GetPullRequestCommitsResponseDTO,
  PullRequestCommitPositionDTO,
  GetPullRequestFilesResponseDTO,
  GetPullRequestPatchQueryDTO,
  MergePullRequestRequestDTO,
  MergePullRequestResponseDTO,
  MergeRequirementsDTO,
  MergeRequirementsQueryDTO,
} from './dto/pull-request-changes.dto.js';
import { PullRequestsService } from './pull-requests.service.js';
import { TransformToLowercasePipe } from '../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

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
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
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
  @SignInOptional()
  @ApiOperation({ summary: 'List pull requests' })
  @ApiOkResponse({ type: GetPullRequestsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getPullRequests(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
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
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
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
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
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
  @SignInOptional()
  @ApiOperation({ summary: 'Get a pull request' })
  @ApiOkResponse({ type: PullRequestDetailDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getPullRequest(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
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
  @SignInOptional()
  @ApiOperation({ summary: 'Commits a pull request adds' })
  @ApiOkResponse({ type: GetPullRequestCommitsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getCommits(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
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

  @Get(':number/commits/:sha')
  @SignInOptional()
  @ApiOperation({
    summary:
      "Where a commit falls among a pull request's commits, with its neighbours",
  })
  @ApiOkResponse({ type: PullRequestCommitPositionDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  locateCommit(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Param('sha') sha: string,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.locateCommit({
      username,
      repo,
      number,
      sha,
      requesterId: session?.user?.id,
    });
  }

  @Get(':number/files')
  @SignInOptional()
  @ApiOperation({ summary: 'Paths a pull request changes' })
  @ApiOkResponse({ type: GetPullRequestFilesResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getFiles(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
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
  @SignInOptional()
  @ApiOperation({ summary: 'The patch itself, as text' })
  @ApiOkResponse({ schema: { type: 'string' } })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  async getPatch(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
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

  @Post(':number/merge')
  @ApiOperation({ summary: 'Merge a pull request into its base branch' })
  @ApiOkResponse({ type: MergePullRequestResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  mergePullRequest(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
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
      message: body.message,
      method: body.method,
      bypassRules: body.bypassRules,
    });
  }

  @Get(':number/merge-requirements')
  @ApiOperation({
    summary: 'What stands between the viewer and merging a pull request',
  })
  @ApiOkResponse({ type: MergeRequirementsDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  getMergeRequirements(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Query() query: MergeRequirementsQueryDTO,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.mergeRequirements({
      username,
      repo,
      number,
      requesterId: session.user.id,
      method: query.method,
    });
  }

  @Patch(':number')
  @ApiOperation({ summary: 'Edit a pull request title or description' })
  @ApiOkResponse({ type: PullRequestDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  updatePullRequest(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
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
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
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

  @Post(':number/ready')
  @ApiOperation({ summary: 'Mark a draft pull request ready for review' })
  @ApiOkResponse({ type: PullRequestDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  markReadyForReview(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.setDraft({
      username,
      repo,
      number,
      requesterId: session.user.id,
      draft: false,
    });
  }

  @Post(':number/draft')
  @ApiOperation({ summary: 'Turn a pull request back into a draft' })
  @ApiOkResponse({ type: PullRequestDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  convertToDraft(
    @Param('username',TransformToLowercasePipe) username: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('number', ParseIntPipe) number: number,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.setDraft({
      username,
      repo,
      number,
      requesterId: session.user.id,
      draft: true,
    });
  }
}

@Controller('user')
@ApiTags('Pull requests')
export class ViewerPullRequestsController {
  constructor(private readonly pullRequests: PullRequestsService) {}

  @Get('review-requests')
  @ApiOperation({
    summary: 'Open pull requests asking the signed-in user for a review',
    description:
      'Requests to the user directly or to one of their teams, in every repository the user can read.',
  })
  @ApiOkResponse({ type: GetPullRequestsResponseDTO })
  getReviewRequests(
    @Query() query: GetReviewRequestsQueryDTO,
    @Session() session: UserSession,
  ) {
    return this.pullRequests.getReviewRequests({
      requesterId: session.user.id,
      query,
    });
  }
}
