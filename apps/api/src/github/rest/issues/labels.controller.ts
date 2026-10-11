import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';

import { labelNamesOf, pageOf } from '../../../lib/github/rest.js';
import type { LabelDTO } from '../../../resources/issues/dto/label.dto.js';
import { IssuesService } from '../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubPageQueryDTO } from './dto/issue.dto.js';
import { GithubCreateLabelDTO, GithubUpdateLabelDTO } from './dto/label.dto.js';
import { GithubIssuesService } from './issues.service.js';

const NUMBER = new ParseIntPipe({ errorHttpStatusCode: 404 });

const LABELS_BODY = {
  description:
    '`{ labels: [...] }` or a bare array, of names or `{ name }` objects. Missing labels are created.',
  schema: {},
};

@Controller('v3/repos/:owner/:repo')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class LabelsController {
  constructor(
    private readonly github: GithubIssuesService,
    private readonly issues: IssuesService,
  ) {}

  @Get('labels')
  @ApiOperation({ summary: "A repository's labels, by name" })
  async list(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const { labels } = await this.issues.listLabels(
      this.github.ref(repository, viewer),
    );
    return this.page(repository, labels, query, request, response);
  }

  @Post('labels')
  @ApiOperation({ summary: 'Create a label' })
  async create(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Body() body: GithubCreateLabelDTO,
    @Viewer() viewer: GithubViewer | null,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/labels',
    );
    const created = await this.issues.createLabel({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      body: {
        name: body.name,
        color: body.color ?? 'ededed',
        description: body.description,
      },
    });
    const [label] = await this.github.labels(repository, [created]);
    response.setHeader('Location', label.url);
    return label;
  }

  @Get('labels/:name')
  @ApiOperation({ summary: 'A label by name' })
  async get(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const label = await this.github.labelByName(repository, viewer, name);
    const [rest] = await this.github.labels(repository, [label]);
    return rest;
  }

  @Patch('labels/:name')
  @ApiOperation({ summary: 'Rename, recolor or describe a label' })
  async update(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('name') name: string,
    @Body() body: GithubUpdateLabelDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'PATCH /repos/:owner/:repo/labels/:name',
    );
    const label = await this.github.labelByName(repository, signedIn, name);
    const updated = await this.issues.updateLabel({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      labelId: label.id,
      body: {
        name: body.new_name,
        color: body.color,
        description: body.description,
      },
    });
    const [rest] = await this.github.labels(repository, [updated]);
    return rest;
  }

  @Delete('labels/:name')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a label' })
  async delete(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'DELETE /repos/:owner/:repo/labels/:name',
    );
    const label = await this.github.labelByName(repository, signedIn, name);
    await this.issues.deleteLabel({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      labelId: label.id,
    });
  }

  @Get('issues/:number/labels')
  @ApiOperation({ summary: "An issue's labels" })
  async listOnIssue(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const issue = await this.issues.getIssue({
      ...this.github.ref(repository, viewer),
      number,
    });
    return this.page(repository, issue.labels, query, request, response);
  }

  @Post('issues/:number/labels')
  @HttpCode(200)
  @ApiBody(LABELS_BODY)
  @ApiOperation({
    summary: "Add labels to an issue; answers all of the issue's labels",
  })
  add(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: unknown,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const names = labelNamesOf(body);
    return this.changeLabels(
      owner,
      repo,
      number,
      viewer,
      'POST /repos/:owner/:repo/issues/:number/labels',
      names,
      (current) => [...current, ...names],
    );
  }

  @Put('issues/:number/labels')
  @ApiBody(LABELS_BODY)
  @ApiOperation({ summary: "Replace an issue's labels" })
  set(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: unknown,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const names = labelNamesOf(body);
    return this.changeLabels(
      owner,
      repo,
      number,
      viewer,
      'PUT /repos/:owner/:repo/issues/:number/labels',
      names,
      () => names,
    );
  }

  @Delete('issues/:number/labels')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove every label from an issue' })
  async clear(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    await this.changeLabels(
      owner,
      repo,
      number,
      viewer,
      'DELETE /repos/:owner/:repo/issues/:number/labels',
      [],
      () => [],
    );
  }

  @Delete('issues/:number/labels/:name')
  @ApiOperation({
    summary: 'Remove one label from an issue; answers the labels left',
  })
  remove(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Param('number', NUMBER) number: number,
    @Param('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.changeLabels(
      owner,
      repo,
      number,
      viewer,
      'DELETE /repos/:owner/:repo/issues/:number/labels/:name',
      [],
      (current) => {
        if (!current.includes(name)) throw new NotFoundException();
        return current.filter((label) => label !== name);
      },
    );
  }

  /** Every label write is a read, then a full replacement through IssuesService, creating the labels it names that do not exist yet. */
  private async changeLabels(
    owner: string,
    repo: string,
    number: number,
    viewer: GithubViewer | null,
    route: string,
    added: string[],
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
    const issue = await this.issues.getIssue(ref);
    await this.github.ensureLabels(repository, signedIn, added);
    // ponytail: read then replace; two concurrent adds can lose one. Add IssuesService.addIssueLabels if that bites.
    const { labels } = await this.issues.setIssueLabels({
      ...ref,
      names: next(issue.labels.map((label) => label.name)),
    });
    return this.github.labels(repository, labels);
  }

  // ponytail: labels are listed whole by IssuesService and sliced here; a repository with thousands of labels would want paging in the query.
  private async page(
    repository: RepositoryNode,
    labels: LabelDTO[],
    query: GithubPageQueryDTO,
    request: Request,
    response: Response,
  ) {
    const page = pageOf(query);
    this.github.link(request, response, page, labels.length);
    return this.github.labels(
      repository,
      labels.slice(page.offset, page.offset + page.perPage),
    );
  }
}
