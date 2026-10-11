import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseFilters,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';

import { encodeNodeId } from '../../../lib/github/node-id.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { pageOf } from '../../../lib/github/rest.js';
import {
  NothingToMergeError,
  PullRequestConflictError,
  PullRequestDraftError,
  PullRequestNotOpenError,
} from '../../../lib/pull-requests/pull-requests.errors.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import { PullRequestsService } from '../../../resources/pull-requests/pull-requests.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import { GithubIssuesService } from '../issues/issues.service.js';
import {
  GithubCreatePullDTO,
  GithubListPullsQueryDTO,
  GithubMergePullDTO,
  GithubUpdatePullDTO,
} from './dto/pull.dto.js';
import { GithubPullsService } from './pulls.service.js';

const NUMBER = new ParseIntPipe({ errorHttpStatusCode: 404 });
const RAW = /application\/vnd\.github(?:\.v3)?\.(diff|patch)\b/i;

// ponytail: a pull request's commits are listed in one page of this many, as GitHub caps the route at 250.
const MAX_COMMITS = 250;

const FILE_STATUS: Record<string, string> = {
  A: 'added',
  D: 'removed',
  M: 'modified',
  T: 'changed',
};

/** GitHub's `head`: `owner:branch`, or a bare branch from any owner. */
function headFilter(head: string | undefined) {
  if (!head) return {};
  const colon = head.indexOf(':');
  return colon < 0
    ? { headRef: head }
    : {
        headOwner: head.slice(0, colon),
        headRef: head.slice(colon + 1) || undefined,
      };
}

@Controller('v3/repos/:owner/:repo/pulls')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class PullsController {
  constructor(
    private readonly github: GithubIssuesService,
    private readonly pullsRest: GithubPullsService,
    private readonly issues: IssuesService,
    private readonly pulls: PullRequestsService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @ApiOperation({ summary: "A repository's pull requests" })
  async list(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: GithubListPullsQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const state = query.state ?? 'open';
    const list = await this.issues.getIssues(
      {
        ...this.github.ref(repository, viewer),
        query: {
          state: 'all',
          sort: query.sort === 'updated' ? 'updated' : 'created',
          direction: query.direction,
          limit: page.perPage,
        },
      },
      {
        offset: page.offset,
        pullRequests: {
          states:
            state === 'open'
              ? ['open']
              : state === 'closed'
                ? ['closed', 'merged']
                : undefined,
          ...headFilter(query.head),
          baseRef: query.base,
        },
      },
    );
    this.github.link(request, response, page, list.total);
    return this.pullsRest.list(repository, viewer, list.issues);
  }

  @Post()
  @ApiOperation({ summary: 'Open a pull request' })
  async create(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() body: GithubCreatePullDTO,
    @Viewer() viewer: GithubViewer | null,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/pulls',
    );
    const forkOwner = body.head_repo?.split('/')[0];
    const created = await this.pulls.createPullRequest({
      username: repository.ownerLogin,
      repo: repository.slug,
      requesterId: signedIn.userId,
      body: {
        title: body.title,
        body: body.body,
        base: body.base,
        head:
          forkOwner && !body.head.includes(':')
            ? `${forkOwner}:${body.head}`
            : body.head,
        draft: body.draft,
      },
    });
    const pull = await this.pullsRest.one(repository, signedIn, created.number);
    response.status(HttpStatus.CREATED).setHeader('Location', pull.url);
    return pull;
  }

  /** JSON, or the raw diff or patch when the Accept header asks for one, as `gh pr diff` does. */
  @Get(':number')
  @ApiOperation({ summary: 'A pull request, or its diff or patch' })
  async get(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Headers('accept') accept: string | undefined,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const raw = RAW.exec(accept ?? '');
    if (!raw) return this.pullsRest.one(repository, viewer, number);
    await this.pullsRest.issue(repository, viewer, number);
    return new StreamableFile(
      await this.pulls.streamPatch({
        ...this.github.ref(repository, viewer),
        number,
        mailbox: raw[1]!.toLowerCase() === 'patch',
      }),
      { type: 'text/plain; charset=utf-8' },
    );
  }

  @Patch(':number')
  @ApiOperation({ summary: 'Edit a pull request: title, body, state' })
  async update(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubUpdatePullDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'PATCH /repos/:owner/:repo/pulls/:number',
    );
    const ref = {
      ...this.github.ref(repository, signedIn),
      number,
      requesterId: signedIn.userId,
    };
    const current = await this.pulls.load(ref);
    if (body.base !== undefined && body.base !== current.pullRequest.baseRef)
      throw new HttpException(
        'Ghost cannot change the base branch of a pull request',
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    if (body.title !== undefined || body.body !== undefined)
      await this.pulls.updatePullRequest({
        ...ref,
        body: { title: body.title, body: body.body },
      });
    // Setting the state a request already has is a no-op on GitHub; Ghost refuses it.
    const state = current.pullRequest.state;
    if (body.state === 'closed' && state === 'open')
      await this.pulls.closePullRequest(ref);
    if (body.state === 'open' && state === 'closed')
      await this.pulls.reopenPullRequest(ref);
    return this.pullsRest.one(repository, signedIn, number);
  }

  @Get(':number/commits')
  @ApiOperation({ summary: "A pull request's commits, oldest first" })
  async commits(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    await this.pullsRest.issue(repository, viewer, number);
    const page = pageOf(query);
    const { commits, total } = await this.pulls.getCommits({
      ...this.github.ref(repository, viewer),
      number,
      limit: MAX_COMMITS,
    });
    this.github.link(request, response, page, Math.min(total, MAX_COMMITS));
    const users = await this.pullsRest.commitUsers(
      commits.flatMap((commit) => [commit.authorEmail, commit.committerEmail]),
    );
    const userOf = (email: string) => users.get(email.toLowerCase()) ?? null;
    const apiUrl = `${githubOrigins(this.config).api}/api/v3/repos/${repository.nameWithOwner}`;
    return commits
      .toReversed()
      .slice(page.offset, page.offset + page.perPage)
      .map((commit) => ({
        sha: commit.sha,
        node_id: encodeNodeId('Commit', `${repository.ghostId}:${commit.sha}`),
        commit: {
          author: {
            name: commit.authorName,
            email: commit.authorEmail,
            date: commit.authoredAt,
          },
          committer: {
            name: commit.committerName,
            email: commit.committerEmail,
            date: commit.committedAt,
          },
          message: [commit.subject, commit.body].filter(Boolean).join('\n\n'),
          url: `${apiUrl}/git/commits/${commit.sha}`,
          comment_count: 0,
          verification: {
            verified: commit.verification?.verified ?? false,
            reason: commit.verification?.verified
              ? 'valid'
              : commit.verification?.keyId
                ? 'unknown_key'
                : 'unsigned',
            signature: null,
            payload: null,
            verified_at: null,
          },
        },
        url: `${apiUrl}/commits/${commit.sha}`,
        html_url: `${repository.url}/commit/${commit.sha}`,
        comments_url: `${apiUrl}/commits/${commit.sha}/comments`,
        author: userOf(commit.authorEmail),
        committer: userOf(commit.committerEmail),
      }));
  }

  @Get(':number/reviews')
  @ApiOperation({ summary: "A pull request's reviews, oldest first" })
  async reviews(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const reviews = await this.pullsRest.reviews(repository, viewer, number);
    this.github.link(request, response, page, reviews.length);
    return reviews.slice(page.offset, page.offset + page.perPage);
  }

  @Get(':number/reviews/:review_id')
  @ApiOperation({ summary: 'One review of a pull request, by its integer id' })
  async review(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Param('review_id', NUMBER) reviewId: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const review = (
      await this.pullsRest.reviews(repository, viewer, number)
    ).find((candidate) => candidate.id === reviewId);
    if (!review) throw new NotFoundException();
    return review;
  }

  @Get(':number/files')
  @ApiOperation({ summary: 'The files a pull request changes' })
  async files(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    await this.pullsRest.issue(repository, viewer, number);
    const page = pageOf(query);
    const { to, files } = await this.pulls.getFiles({
      ...this.github.ref(repository, viewer),
      number,
    });
    this.github.link(request, response, page, files.length);
    return files.slice(page.offset, page.offset + page.perPage).map((file) => ({
      filename: file.path,
      status: FILE_STATUS[file.status] ?? 'modified',
      additions: file.additions,
      deletions: file.deletions,
      changes: file.additions + file.deletions,
      blob_url: `${repository.url}/blob/${to}/${file.path}`,
      raw_url: `${repository.url}/raw/${to}/${file.path}`,
    }));
  }

  /** 204 when merged, 404 otherwise, as GitHub answers. */
  @Get(':number/merge')
  @HttpCode(204)
  @ApiOperation({ summary: 'Whether a pull request has been merged' })
  async merged(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const { pullRequest } = await this.pulls.load({
      ...this.github.ref(repository, viewer),
      number,
    });
    if (pullRequest.state !== 'merged') throw new NotFoundException();
  }

  @Put(':number/merge')
  @ApiOperation({ summary: 'Merge a pull request' })
  async merge(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubMergePullDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'PUT /repos/:owner/:repo/pulls/:number/merge',
    );
    const ref = {
      ...this.github.ref(repository, signedIn),
      number,
      requesterId: signedIn.userId,
    };
    if (body.sha) {
      // ponytail: checked before the merge, not under its lock; a push landing in between merges the newer head.
      const { headSha } = await this.pulls.getPullRequest(ref);
      if (headSha !== body.sha)
        throw new HttpException(
          'Head branch was modified. Review and try the merge again.',
          HttpStatus.CONFLICT,
        );
    }
    try {
      const { mergeCommitSha } = await this.pulls.mergePullRequest({
        ...ref,
        method: body.merge_method,
        title: body.commit_title || undefined,
        message: body.commit_message,
      });
      return {
        sha: mergeCommitSha,
        merged: true,
        message: 'Pull Request successfully merged',
      };
    } catch (error) {
      // GitHub answers every merge it will not make with 405.
      if (
        error instanceof PullRequestConflictError ||
        error instanceof PullRequestDraftError ||
        error instanceof PullRequestNotOpenError ||
        error instanceof NothingToMergeError
      )
        throw new HttpException(
          'Pull Request is not mergeable',
          HttpStatus.METHOD_NOT_ALLOWED,
        );
      throw error;
    }
  }
}
