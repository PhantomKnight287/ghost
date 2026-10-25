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
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import { GithubCommentsService } from './comments.service.js';
import {
  GithubCommentDTO,
  GithubListCommentsQueryDTO,
} from './dto/issue.dto.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

const ID = new ParseIntPipe({ errorHttpStatusCode: 404 });

/** Registered before IssuesController, so `issues/comments` is not read as issue number "comments". */
@Controller('v3/repos/:owner/:repo/issues')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
export class CommentsController {
  constructor(private readonly comments: GithubCommentsService) {}

  @Get('comments')
  @ApiOperation({
    summary: "Every comment in a repository's issues and pull requests",
  })
  listForRepository(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Query() query: GithubListCommentsQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.listForRepository({ owner, repo, viewer }, query);
  }

  @Get('comments/:comment_id')
  @ApiOperation({ summary: 'A comment by id' })
  get(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('comment_id', ID) id: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.get({ owner, repo, viewer }, id);
  }

  @Patch('comments/:comment_id')
  @ApiOperation({ summary: 'Edit a comment; only its author may' })
  update(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('comment_id', ID) id: number,
    @Body() body: GithubCommentDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.update({ owner, repo, viewer }, id, body);
  }

  @Delete('comments/:comment_id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a comment' })
  delete(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('comment_id', ID) id: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.delete({ owner, repo, viewer }, id);
  }

  @Get(':number/comments')
  @ApiOperation({ summary: "An issue's comments, oldest first" })
  list(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ID) number: number,
    @Query() query: GithubListCommentsQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.list({ owner, repo, viewer }, number, query);
  }

  @Post(':number/comments')
  @ApiOperation({ summary: 'Comment on an issue or pull request' })
  create(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', ID) number: number,
    @Body() body: GithubCommentDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.comments.create({ owner, repo, viewer }, number, body);
  }
}
