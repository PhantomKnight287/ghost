import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalAuth } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import { GetRepositoriesQueryDTO } from './dto/get-repositories.dto.js';
import {
  SearchCodeQueryDTO,
  SearchCodeResponseDTO,
} from './dto/search-code.dto.js';
import { SearchRepositoriesResponseDTO } from './dto/search-repositories.dto.js';
import { RepositoriesService } from './repositories.service.js';

@Controller('search')
@ApiTags('Search')
export class SearchController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Get('repositories')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Search repositories',
    description:
      'Public repositories whose name or description matches, most recently pushed first. Pages are cursor-based: pass a response `nextCursor` back as `cursor`.',
  })
  @ApiOkResponse({ type: SearchRepositoriesResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  searchRepositories(
    @Query() query: GetRepositoriesQueryDTO,
  ): Promise<SearchRepositoriesResponseDTO> {
    return this.repositoriesService.searchRepositories(query);
  }

  @Get('code')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Search code',
    description:
      'Full-text and regex search over the default branch of public repositories, powered by zoekt.',
  })
  @ApiOkResponse({ type: SearchCodeResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiServiceUnavailableResponse({ type: ErrorResponseDTO })
  searchCode(
    @Query() query: SearchCodeQueryDTO,
  ): Promise<SearchCodeResponseDTO> {
    return this.repositoriesService.searchCode({
      query: query.q,
      limit: query.limit,
    });
  }
}
