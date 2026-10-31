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
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import {
  PullRequestsOnPulls,
  RequireAppPermission,
} from '../../../lib/apps/app-permission.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { ApiGithubErrors } from '../dto/error.dto.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import { GithubSimpleUserDTO } from '../users/dto/user.dto.js';
import {
  GithubAssigneesDTO,
  GithubCreateIssueDTO,
  GithubIssueDTO,
  GithubListIssuesQueryDTO,
  GithubPageQueryDTO,
  GithubUpdateIssueDTO,
} from './dto/issue.dto.js';
import { GithubIssuesService } from './issues.service.js';

const NUMBER = new ParseIntPipe({ errorHttpStatusCode: 404 });

@RequireAppPermission('issues')
@PullRequestsOnPulls()
@Controller('v3/repos/:owner/:repo')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
@ApiGithubErrors()
export class IssuesController {
  constructor(private readonly issues: GithubIssuesService) {}

  @Get('issues')
  @ApiOperation({ summary: "A repository's issues and pull requests" })
  @ApiOkResponse({ type: [GithubIssueDTO] })
  list(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Query() query: GithubListIssuesQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.listIssues({ owner, repo, viewer }, query);
  }

  @Post('issues')
  @ApiOperation({ summary: 'Open an issue' })
  @ApiCreatedResponse({ type: GithubIssueDTO })
  create(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Body() body: GithubCreateIssueDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.createIssue({ owner, repo, viewer }, body);
  }

  @Get('issues/:number')
  @ApiOperation({ summary: 'An issue or pull request by number' })
  @ApiOkResponse({ type: GithubIssueDTO })
  get(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.getIssue({ owner, repo, viewer }, number);
  }

  @Patch('issues/:number')
  @ApiOperation({
    summary: 'Edit an issue: title, body, state, labels, assignees',
  })
  @ApiOkResponse({ type: GithubIssueDTO })
  update(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubUpdateIssueDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.updateIssue({ owner, repo, viewer }, number, body);
  }

  @Post('issues/:number/assignees')
  @ApiOperation({ summary: 'Add up to 10 assignees to an issue' })
  @ApiCreatedResponse({ type: GithubIssueDTO })
  addAssignees(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
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
  @ApiOkResponse({ type: GithubIssueDTO })
  removeAssignees(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
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
  @ApiNoContentResponse({
    description: 'The user can be assigned; 404 otherwise.',
  })
  canBeAssignedToIssue(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
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
  @ApiOkResponse({ type: [GithubSimpleUserDTO] })
  assignees(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.listAssignees({ owner, repo, viewer }, query);
  }

  @Get('assignees/:assignee')
  @HttpCode(204)
  @ApiOperation({ summary: 'Whether a user can be assigned in the repository' })
  @ApiNoContentResponse({
    description: 'The user can be assigned; 404 otherwise.',
  })
  canBeAssigned(
    @Param('owner', TransformToLowercasePipe) owner: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('assignee') assignee: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.issues.canBeAssigned({ owner, repo, viewer }, assignee);
  }
}
