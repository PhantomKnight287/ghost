import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Session,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
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
import {
  CreateReleaseRequestDTO,
  GetReleasesQueryDTO,
  GetReleasesResponseDTO,
  ReleaseDTO,
  UpdateReleaseRequestDTO,
} from './dto/release.dto.js';
import { ReleasesService } from './releases.service.js';

@Controller('repositories/:username/:repo/releases')
@ApiTags('Releases')
export class ReleasesController {
  constructor(private readonly releases: ReleasesService) {}

  @Get()
  @OptionalAuth()
  @ApiOperation({
    summary: 'List releases',
    description:
      'Newest first. Drafts are listed only for people who can write to the repository. Pages are cursor-based: pass a response `nextCursor` back as `cursor`.',
  })
  @ApiOkResponse({ type: GetReleasesResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  listReleases(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Query() query: GetReleasesQueryDTO,
    @Session() session: UserSession | undefined,
  ): Promise<GetReleasesResponseDTO> {
    return this.releases.listReleases({
      username,
      repo,
      requesterId: session?.user?.id,
      query,
    });
  }

  @Post()
  @ApiOperation({
    summary: 'Create a release',
    description:
      'Needs write access. A tag that does not exist yet is created at `target`, or at the default branch.',
  })
  @ApiCreatedResponse({ type: ReleaseDTO })
  @ApiBadRequestResponse({
    description: 'The tag name is not one git accepts.',
    type: ErrorResponseDTO,
  })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({
    description: 'The repository, or the target to tag, does not exist.',
    type: ErrorResponseDTO,
  })
  @ApiConflictResponse({
    description: 'The tag already has a release.',
    type: ErrorResponseDTO,
  })
  createRelease(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Body() body: CreateReleaseRequestDTO,
    @Session() session: UserSession,
  ): Promise<ReleaseDTO> {
    return this.releases.createRelease({
      username,
      repo,
      requesterId: session.user.id,
      body,
    });
  }

  @Get('latest')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Read the latest release',
    description:
      'The most recently published release that is neither a draft nor a prerelease.',
  })
  @ApiOkResponse({ type: ReleaseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getLatestRelease(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Session() session: UserSession | undefined,
  ): Promise<ReleaseDTO> {
    return this.releases.getLatestRelease({
      username,
      repo,
      requesterId: session?.user?.id,
    });
  }

  @Get('tags/:tag')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Read a release by tag',
    description: 'A tag containing `/` is sent percent-encoded.',
  })
  @ApiOkResponse({ type: ReleaseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getReleaseByTag(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('tag') tagName: string,
    @Session() session: UserSession | undefined,
  ): Promise<ReleaseDTO> {
    return this.releases.getReleaseByTag({
      username,
      repo,
      tagName,
      requesterId: session?.user?.id,
    });
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a release',
    description: 'Needs write access. Omitted fields are left as they are.',
  })
  @ApiOkResponse({ type: ReleaseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  updateRelease(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('id') id: string,
    @Body() body: UpdateReleaseRequestDTO,
    @Session() session: UserSession,
  ): Promise<ReleaseDTO> {
    return this.releases.updateRelease({
      username,
      repo,
      id,
      requesterId: session.user.id,
      body,
    });
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a release',
    description: 'Needs write access. The tag is kept.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  deleteRelease(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Param('id') id: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.releases.deleteRelease({
      username,
      repo,
      id,
      requesterId: session.user.id,
    });
  }
}
