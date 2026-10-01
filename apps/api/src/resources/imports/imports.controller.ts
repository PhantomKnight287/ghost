import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Session,
} from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalAuth, type UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import { CreateRepositoryResponseDTO } from '../repositories/dto/create-repository.dto.js';
import {
  GitHubImportStatusDTO,
  GitHubRepositoriesDTO,
  RepositoryImportDTO,
  StartImportRequestDTO,
} from './dto/import.dto.js';
import { ImportsService } from './imports.service.js';

@Controller()
@ApiTags('Imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get('imports/github')
  @ApiOperation({
    summary: 'GitHub import availability',
    description:
      'Whether this instance imports from GitHub, and whether the signed-in user has linked the GitHub account an import reads with.',
  })
  @ApiOkResponse({ type: GitHubImportStatusDTO })
  githubStatus(
    @Session() session: UserSession,
  ): Promise<GitHubImportStatusDTO> {
    return this.imports.githubStatus(session.user.id);
  }

  @Get('imports/github/repositories')
  @ApiOperation({
    summary: 'List GitHub repositories to import',
    description:
      "Repositories the signed-in user's linked GitHub account owns, collaborates on or reaches through an organization, most recently pushed first, capped at 1,000. Public repositories the account merely can read are not listed.",
  })
  @ApiOkResponse({ type: GitHubRepositoriesDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  @ApiBadGatewayResponse({ type: ErrorResponseDTO })
  githubRepositories(
    @Session() session: UserSession,
  ): Promise<GitHubRepositoriesDTO> {
    return this.imports.githubRepositories(session.user.id);
  }

  @Post('imports')
  @ApiOperation({
    summary: 'Import a repository from GitHub',
    description:
      'Creates the repository, then imports its code, releases, issues and pull requests in the background. Watch progress with `GET /repositories/{username}/{repo}/import`.',
  })
  @ApiCreatedResponse({ type: CreateRepositoryResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  @ApiBadGatewayResponse({ type: ErrorResponseDTO })
  start(
    @Body() body: StartImportRequestDTO,
    @Session() session: UserSession,
  ): Promise<CreateRepositoryResponseDTO> {
    return this.imports.start(body, session.user.id);
  }

  @Get('repositories/:username/:repo/import')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Get import progress',
    description: 'How the GitHub import that created this repository is going.',
  })
  @ApiOkResponse({ type: RepositoryImportDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  status(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Session() session: UserSession | undefined,
  ): Promise<RepositoryImportDTO> {
    return this.imports.status({
      username,
      repo,
      requesterId: session?.user.id,
    });
  }

  @Post('repositories/:username/:repo/import/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Retry a failed import',
    description:
      'Starts a failed import over with the caller’s GitHub account. Needs admin on the repository.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({ type: ErrorResponseDTO })
  retry(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Session() session: UserSession,
  ) {
    return this.imports.retry({ username, repo, requesterId: session.user.id });
  }
}
