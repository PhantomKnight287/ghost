import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import {
  GithubCreatePullDTO,
  GithubListPullsQueryDTO,
  GithubMergePullDTO,
  GithubUpdatePullDTO,
} from './dto/pull.dto.js';
import { GithubPullsService } from './pulls.service.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

const NUMBER = new ParseIntPipe({ errorHttpStatusCode: 404 });
const RAW = /application\/vnd\.github(?:\.v3)?\.(diff|patch)\b/i;

@Controller('v3/repos/:owner/:repo/pulls')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
export class PullsController {
  constructor(private readonly pulls: GithubPullsService) {}

  @Get()
  @ApiOperation({ summary: "A repository's pull requests" })
  list(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Query() query: GithubListPullsQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.listPulls({ owner, repo, viewer }, query);
  }

  @Post()
  @ApiOperation({ summary: 'Open a pull request' })
  create(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Body() body: GithubCreatePullDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.createPull({ owner, repo, viewer }, body);
  }

  /** JSON, or the raw diff or patch when the Accept header asks for one, as `gh pr diff` does. */
  @Get(':number')
  @ApiOperation({ summary: 'A pull request, or its diff or patch' })
  async get(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Headers('accept') accept: string | undefined,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const raw = RAW.exec(accept ?? '');
    if (!raw) return this.pulls.getPull({ owner, repo, viewer }, number);
    return new StreamableFile(
      await this.pulls.diff(
        { owner, repo, viewer },
        number,
        raw[1]!.toLowerCase() === 'patch',
      ),
      { type: 'text/plain; charset=utf-8' },
    );
  }

  @Patch(':number')
  @ApiOperation({ summary: 'Edit a pull request: title, body, state' })
  update(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubUpdatePullDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.updatePull({ owner, repo, viewer }, number, body);
  }

  @Get(':number/commits')
  @ApiOperation({ summary: "A pull request's commits, oldest first" })
  commits(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.commits({ owner, repo, viewer }, number, query);
  }

  @Get(':number/files')
  @ApiOperation({ summary: 'The files a pull request changes' })
  files(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.files({ owner, repo, viewer }, number, query);
  }

  /** 204 when merged, 404 otherwise, as GitHub answers. */
  @Get(':number/merge')
  @HttpCode(204)
  @ApiOperation({ summary: 'Whether a pull request has been merged' })
  merged(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.merged({ owner, repo, viewer }, number);
  }

  @Put(':number/merge')
  @ApiOperation({ summary: 'Merge a pull request' })
  merge(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubMergePullDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.pulls.merge({ owner, repo, viewer }, number, body);
  }
}
