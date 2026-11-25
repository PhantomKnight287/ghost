import {
  Controller,
  Get,
  Query,
  UseFilters,
  UseInterceptors,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { SignInOptional } from '../../../auth/api-key-auth.guard.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import { ApiGithubErrors } from '../dto/error.dto.js';
import { GithubRestFilter } from '../github-rest.filter.js';
import { GithubRestInterceptor } from '../github-rest.interceptor.js';
import {
  GithubSearchIssuesDTO,
  GithubSearchIssuesQueryDTO,
} from './dto/search.dto.js';
import { GithubSearchIssuesService } from './search.service.js';

@Controller('v3/search')
@ApiTags('GitHub compatibility')
@SignInOptional()
@UseFilters(GithubRestFilter)
@UseInterceptors(GithubRestInterceptor)
@ApiGithubErrors()
export class SearchIssuesController {
  constructor(private readonly searches: GithubSearchIssuesService) {}

  @Get('issues')
  @ApiOperation({
    summary:
      'Issues and pull requests across every repository the viewer can read',
  })
  @ApiOkResponse({ type: GithubSearchIssuesDTO })
  search(
    @Query() query: GithubSearchIssuesQueryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.searches.search(viewer, query);
  }
}
