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
  Put,
  Query,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import { GithubPageQueryDTO } from './dto/issue.dto.js';
import { GithubCreateLabelDTO, GithubUpdateLabelDTO } from './dto/label.dto.js';
import { GithubLabelsService } from './labels.service.js';
import { TransformToLowercasePipe } from '../../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

const NUMBER = new ParseIntPipe({ errorHttpStatusCode: 404 });

const LABELS_BODY = {
  description:
    '`{ labels: [...] }` or a bare array, of names or `{ name }` objects. Missing labels are created.',
  schema: {},
};

@Controller('v3/repos/:owner/:repo')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
export class LabelsController {
  constructor(private readonly labels: GithubLabelsService) {}

  @Get('labels')
  @ApiOperation({ summary: "A repository's labels, by name" })
  list(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.labels.list({ owner, repo, viewer }, query);
  }

  @Post('labels')
  @ApiOperation({ summary: 'Create a label' })
  create(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Body() body: GithubCreateLabelDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.labels.create({ owner, repo, viewer }, body);
  }

  @Get('labels/:name')
  @ApiOperation({ summary: 'A label by name' })
  get(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.labels.get({ owner, repo, viewer }, name);
  }

  @Patch('labels/:name')
  @ApiOperation({ summary: 'Rename, recolor or describe a label' })
  update(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('name') name: string,
    @Body() body: GithubUpdateLabelDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.labels.update({ owner, repo, viewer }, name, body);
  }

  @Delete('labels/:name')
  @HttpCode(204)
  @ApiOperation({ summary: 'Delete a label' })
  delete(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.labels.delete({ owner, repo, viewer }, name);
  }

  @Get('issues/:number/labels')
  @ApiOperation({ summary: "An issue's labels" })
  listOnIssue(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Query() query: GithubPageQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.labels.listOnIssue({ owner, repo, viewer }, number, query);
  }

  @Post('issues/:number/labels')
  @HttpCode(200)
  @ApiBody(LABELS_BODY)
  @ApiOperation({
    summary: "Add labels to an issue; answers all of the issue's labels",
  })
  add(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: unknown,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.labels.addToIssue({ owner, repo, viewer }, number, body);
  }

  @Put('issues/:number/labels')
  @ApiBody(LABELS_BODY)
  @ApiOperation({ summary: "Replace an issue's labels" })
  set(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Body() body: unknown,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.labels.setOnIssue({ owner, repo, viewer }, number, body);
  }

  @Delete('issues/:number/labels')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove every label from an issue' })
  clear(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.labels.clearOnIssue({ owner, repo, viewer }, number);
  }

  @Delete('issues/:number/labels/:name')
  @ApiOperation({
    summary: 'Remove one label from an issue; answers the labels left',
  })
  remove(
    @Param('owner',TransformToLowercasePipe) owner: string,
    @Param('repo',TransformToLowercasePipe) repo: string,
    @Param('number', NUMBER) number: number,
    @Param('name') name: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.labels.removeFromIssue({ owner, repo, viewer }, number, name);
  }
}
