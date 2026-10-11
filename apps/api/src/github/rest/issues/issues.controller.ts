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

import { GithubValidationError } from '../../../lib/github/github.errors.js';
import { labelNamesOf, pageOf } from '../../../lib/github/rest.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import {
  GithubAssigneesDTO,
  GithubCreateIssueDTO,
  GithubListIssuesQueryDTO,
  GithubPageQueryDTO,
  GithubUpdateIssueDTO,
} from './dto/issue.dto.js';
import { GithubIssuesService } from './issues.service.js';

const NUMBER = new ParseIntPipe({ errorHttpStatusCode: 404 });

/** GitHub's `assignees` plus the deprecated single `assignee`. */
function assigneesOf(body: { assignee?: string | null; assignees?: string[] }) {
  return [...(body.assignees ?? []), ...(body.assignee ? [body.assignee] : [])];
}

function refuseMilestone(milestone: unknown) {
  if (milestone !== undefined && milestone !== null)
    throw new GithubValidationError([
      { resource: 'Issue', field: 'milestone', code: 'invalid' },
    ]);
}

@Controller('v3/repos/:owner/:repo')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class IssuesController {
  constructor(
    private readonly github: GithubIssuesService,
    private readonly issues: IssuesService,
  ) {}

  @Get('issues')
  @ApiOperation({ summary: "A repository's issues and pull requests" })
  async list(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: GithubListIssuesQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const state = query.state ?? 'open';
    const anyOrNone = query.assignee === '*' || query.assignee === 'none';
    const list = await this.issues.getIssues(
      {
        ...this.github.ref(repository, viewer),
        query: {
          state,
          labels: query.labels,
          author: query.creator,
          assignee: anyOrNone ? undefined : query.assignee,
          sort: query.sort,
          direction: query.direction,
          limit: page.perPage,
        },
      },
      {
        offset: page.offset,
        includePullRequests: true,
        since: query.since ? new Date(query.since) : undefined,
        assigned: anyOrNone ? query.assignee === '*' : undefined,
      },
    );
    const total =
      state === 'open'
        ? list.openCount
        : state === 'closed'
          ? list.closedCount
          : list.total;
    this.github.link(request, response, page, total);
    return this.github.issues(repository, list.issues);
  }

  @Post('issues')
  @ApiOperation({ summary: 'Open an issue' })
  async create(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() body: GithubCreateIssueDTO,
    @Viewer() viewer: GithubViewer | null,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/issues',
    );
    refuseMilestone(body.milestone);
    const triage = this.github.canTriage(repository);
    const labels =
      triage && body.labels !== undefined ? labelNamesOf(body.labels) : [];
    await this.github.ensureLabels(repository, signedIn, labels);
    const created = await this.github.assigning(() =>
      this.issues.createIssue({
        username: repository.ownerLogin,
        repo: repository.slug,
        requesterId: signedIn.userId,
        body: {
          title: body.title,
          body: body.body ?? undefined,
          labels,
          assignees: triage ? assigneesOf(body) : [],
        },
      }),
    );
    const issue = await this.github.issue(repository, created);
    response.setHeader('Location', issue.url);
    return issue;
  }

  @Get('issues/:number')
  @ApiOperation({ summary: 'An issue or pull request by number' })
  async get(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const issue = await this.issues.getIssue({
      ...this.github.ref(repository, viewer),
      number,
    });
    return this.github.issue(repository, issue);
  }

  @Patch('issues/:number')
  @ApiOperation({
    summary: 'Edit an issue: title, body, state, labels, assignees',
  })
  async update(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: GithubUpdateIssueDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'PATCH /repos/:owner/:repo/issues/:number',
    );
    refuseMilestone(body.milestone);
    const ref = {
      ...this.github.ref(repository, signedIn),
      number,
      requesterId: signedIn.userId,
    };
    const current = await this.issues.getIssue(ref);
    const triage = this.github.canTriage(repository);
    const labels =
      triage && body.labels !== undefined ? labelNamesOf(body.labels) : null;
    if (body.title !== undefined || body.body !== undefined)
      await this.issues.updateIssue({
        ...ref,
        body: { title: body.title, body: body.body },
      });
    // Closing a closed issue is a no-op on GitHub; Ghost refuses it.
    if (body.state === 'closed' && current.state === 'open')
      await this.issues.closeIssue(ref);
    if (body.state === 'open' && current.state === 'closed')
      await this.issues.reopenIssue(ref);
    if (labels) {
      await this.github.ensureLabels(repository, signedIn, labels);
      await this.issues.setIssueLabels({ ...ref, names: labels });
    }
    if (triage && (body.assignees !== undefined || body.assignee !== undefined))
      await this.github.assigning(() =>
        this.issues.setIssueAssignees({ ...ref, usernames: assigneesOf(body) }),
      );
    return this.github.issue(repository, await this.issues.getIssue(ref));
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
    return this.changeAssignees(
      owner,
      repo,
      number,
      viewer,
      'POST /repos/:owner/:repo/issues/:number/assignees',
      (current) => [...current, ...body.assignees],
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
    return this.changeAssignees(
      owner,
      repo,
      number,
      viewer,
      'DELETE /repos/:owner/:repo/issues/:number/assignees',
      (current) => current.filter((login) => !body.assignees.includes(login)),
    );
  }

  @Get('issues/:number/assignees/:assignee')
  @HttpCode(204)
  @ApiOperation({ summary: 'Whether a user can be assigned to an issue' })
  async canBeAssignedToIssue(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Param('assignee') assignee: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    await this.issues.getIssue({
      ...this.github.ref(repository, viewer),
      number,
    });
    await this.github.requireUser(assignee);
  }

  @Get('assignees')
  @ApiOperation({ summary: 'People with access to the repository' })
  async assignees(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const { users, total } = await this.github.assignees(repository, page);
    this.github.link(request, response, page, total);
    return users;
  }

  @Get('assignees/:assignee')
  @HttpCode(204)
  @ApiOperation({ summary: 'Whether a user can be assigned in the repository' })
  async canBeAssigned(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('assignee') assignee: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    await this.github.readable(owner, repo, viewer);
    await this.github.requireUser(assignee);
  }

  /** Add and remove are a read, then a full replacement through IssuesService. */
  private async changeAssignees(
    owner: string,
    repo: string,
    number: number,
    viewer: GithubViewer | null,
    route: string,
    next: (current: string[]) => string[],
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      route,
    );
    const ref = {
      ...this.github.ref(repository, signedIn),
      number,
      requesterId: signedIn.userId,
    };
    const current = await this.issues.getIssue(ref);
    // ponytail: read then replace; two concurrent adds can lose one. Add IssuesService.addIssueAssignees if that bites.
    if (this.github.canTriage(repository))
      await this.github.assigning(() =>
        this.issues.setIssueAssignees({
          ...ref,
          usernames: next(current.assignees),
        }),
      );
    return this.github.issue(repository, await this.issues.getIssue(ref));
  }
}
