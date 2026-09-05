import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Session,
} from '@nestjs/common';
import { RepositoriesService } from './repositories.service.js';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  CreateRepositoryRequestDTO,
  CreateRepositoryResponseDTO,
} from './dto/create-repository.dto.js';
import { OptionalAuth, type UserSession } from '@thallesp/nestjs-better-auth';
import { ErrorResponseDTO } from '../../domain/http.js';
import {
  GetRepositoriesQueryDTO,
  GetRepositoriesResponseDTO,
} from './dto/get-repositories.dto.js';
import { RepositoryEntity } from './entities/repository.entity.js';
import {
  GetRepositoryContentsQueryDTO,
  GetRepositoryContentsResponseDTO,
} from './dto/get-repository-contents.dto.js';
import { GetRepositoryBranchesResponseDTO } from './dto/get-repository-branches.dto.js';

@Controller('repositories')
@ApiTags('Repositories')
export class RepositoriesController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create Repository',
    description: 'Create Repository',
  })
  @ApiCreatedResponse({
    type: CreateRepositoryResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDTO,
  })
  createRepository(
    @Body() body: CreateRepositoryRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.repositoriesService.createRepository(body, session.user.id);
  }

  @Get(':username')
  @ApiOperation({
    summary: 'Get repositories for username',
    description: 'Get repositories for username',
  })
  @ApiOkResponse({
    type: GetRepositoriesResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDTO,
  })
  @OptionalAuth()
  getRepositories(
    @Param('username') username: string,
    @Session() session: UserSession,
    @Query() query: GetRepositoriesQueryDTO,
  ) {
    return this.repositoriesService.getRepositories(
      username,
      session?.user?.id,
      query,
    );
  }

  @Get(':username/:slug')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Get repository details',
    description: 'Get a single repository by owner username and slug',
  })
  @ApiOkResponse({
    type: RepositoryEntity,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDTO,
  })
  getRepository(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
  ) {
    return this.repositoriesService.getRepository({
      username,
      slug,
      requesterId: session?.user?.id,
    });
  }

  @Get(':username/:slug/contents')
  @OptionalAuth()
  @ApiOperation({
    summary: 'List repository contents',
    description:
      'One level of a directory on the requested branch, or the default branch ' +
      'when none is given, with the newest commit ' +
      'touching each entry. Directories report the newest commit anywhere beneath them.',
  })
  @ApiOkResponse({
    type: GetRepositoryContentsResponseDTO,
  })
  @ApiBadRequestResponse({
    description:
      'The `path` query parameter is not a repository-relative directory.',
    type: ErrorResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDTO,
  })
  getRepositoryContents(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
    @Query() query: GetRepositoryContentsQueryDTO,
  ): Promise<GetRepositoryContentsResponseDTO> {
    return this.repositoriesService.getRepositoryContents({
      username,
      repo: slug,
      path: query.path,
      branch: query.branch,
      requesterId: session?.user?.id,
    });
  }

  @Get(':username/:slug/branches')
  @OptionalAuth()
  @ApiOperation({
    summary: 'List repository branches',
    description: 'Every branch of the repository, and which one it opens on.',
  })
  @ApiOkResponse({
    type: GetRepositoryBranchesResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDTO,
  })
  getRepositoryBranches(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
  ): Promise<GetRepositoryBranchesResponseDTO> {
    return this.repositoriesService.getRepositoryBranches({
      username,
      repo: slug,
      requesterId: session?.user?.id,
    });
  }
}
