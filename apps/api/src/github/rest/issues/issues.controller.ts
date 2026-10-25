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
import {
  GithubAssigneesDTO,
  GithubCreateIssueDTO,
  GithubListIssuesQueryDTO,
  GithubPageQueryDTO,
  GithubUpdateIssueDTO,
} from './dto/issue.dto.js';
import { GithubIssuesService } from './issues.service.js';

const NUMBER = new ParseIntPipe({ errorHttpStatusCode: 404 });

@Controller('v3/repos/:owner/:repo')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
export class IssuesController {
  constructor(private readonly issues: GithubIssuesService) {}

  @Get('issues')
  @ApiOperation({ summary: "A repository's issues and pull requests" })
  list(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: GithubListIssuesQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.listIssues({ owner, repo, viewer }, query);
  }

  @Post('issues')
  @ApiOperation({ summary: 'Open an issue' })
  create(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() body: GithubCreateIssueDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.createIssue({ owner, repo, viewer }, body);
  }

  @Get('issues/:number')
  @ApiOperation({ summary: 'An issue or pull request by number' })
  get(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.getIssue({ owner, repo, viewer }, number);
  }

  @Patch('issues/:number')
  @ApiOperation({
    summary: 'Edit an issue: title, body, state, labels, assignees',
  })
  update(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubUpdateIssueDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.updateIssue({ owner, repo, viewer }, number, body);
  }

  @Post('issues/:number/assignees')
  @ApiOperation({ summary: 'Add up to 10 assignees to an issue' })
  addAssignees(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubAssigneesDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.addAssignees(
      { owner, repo, viewer },
      number,
      body.assignees,
    );
  }

  @Delete('issues/:number/assignees')
  @ApiOperation({ summary: 'Remove assignees from an issue' })
  removeAssignees(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubAssigneesDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.removeAssignees(
      { owner, repo, viewer },
      number,
      body.assignees,
    );
  }

  @Get('issues/:number/assignees/:assignee')
  @HttpCode(204)
  @ApiOperation({ summary: 'Whether a user can be assigned to an issue' })
  canBeAssignedToIssue(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Param('assignee') assignee: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.canBeAssignedToIssue(
      { owner, repo, viewer },
      number,
      assignee,
    );
  }

  @Get('assignees')
  @ApiOperation({ summary: 'People with access to the repository' })
  assignees(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.listAssignees({ owner, repo, viewer }, query);
  }

  @Get('assignees/:assignee')
  @HttpCode(204)
  @ApiOperation({ summary: 'Whether a user can be assigned in the repository' })
  canBeAssigned(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('assignee') assignee: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.canBeAssigned({ owner, repo, viewer }, assignee);
  }
}
