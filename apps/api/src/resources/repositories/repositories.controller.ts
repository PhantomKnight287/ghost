import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Res,
  Session,
  StreamableFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OptionalAuth, type UserSession } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';
import { ErrorResponseDTO } from '../../domain/http.js';
import {
  CreateRepositoryRequestDTO,
  CreateRepositoryResponseDTO,
} from './dto/create-repository.dto.js';
import {
  GetRepositoriesQueryDTO,
  GetRepositoriesResponseDTO,
} from './dto/get-repositories.dto.js';
import {
  GetRepositoryBlobQueryDTO,
  GetRepositoryBlobResponseDTO,
} from './dto/get-repository-blob.dto.js';
import { GetRepositoryBranchesResponseDTO } from './dto/get-repository-branches.dto.js';
import { GetRepositoryLanguagesResponseDTO } from './dto/get-repository-languages.dto.js';
import {
  GetRepositoryForksQueryDTO,
  GetRepositoryForksResponseDTO,
} from './dto/get-repository-forks.dto.js';
import {
  GetRepositoryContributorsQueryDTO,
  GetRepositoryContributorsResponseDTO,
} from './dto/get-repository-contributors.dto.js';
import {
  GetRepositoryStargazersQueryDTO,
  GetRepositoryStargazersResponseDTO,
} from './dto/get-repository-stargazers.dto.js';
import {
  GetCommitPatchQueryDTO,
  GetRepositoryCommitResponseDTO,
  GetRepositoryCommitsQueryDTO,
  GetRepositoryCommitsResponseDTO,
} from './dto/get-repository-commits.dto.js';
import {
  GetRepositoryContentsQueryDTO,
  GetRepositoryContentsResponseDTO,
} from './dto/get-repository-contents.dto.js';
import {
  GetRepositoryReadmeQueryDTO,
  GetRepositoryReadmeResponseDTO,
} from './dto/get-repository-readme.dto.js';
import { StarRepositoryResponseDTO } from './dto/star-repository.dto.js';
import {
  ForkRepositoryRequestDTO,
  ForkRepositoryResponseDTO,
} from './dto/fork-repository.dto.js';
import { RepositoryEntity } from './entities/repository.entity.js';
import { RepositoriesService } from './repositories.service.js';

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

  @Post(':username/:slug/fork')
  @ApiOperation({
    summary: 'Fork repository',
    description:
      'Copy a repository under the requester. One fork per repository per owner.',
  })
  @ApiCreatedResponse({
    type: ForkRepositoryResponseDTO,
  })
  @ApiConflictResponse({
    type: ErrorResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDTO,
  })
  forkRepository(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Body() body: ForkRepositoryRequestDTO,
    @Session() session: UserSession,
  ) {
    return this.repositoriesService.forkRepository({
      username,
      slug,
      requesterId: session.user.id,
      ...body,
    });
  }

  @Post(':username/:slug/star')
  @ApiOperation({
    summary: 'Star repository',
    description:
      'Star a repository. Starring twice leaves the count unchanged.',
  })
  @ApiOkResponse({
    type: StarRepositoryResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDTO,
  })
  starRepository(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession,
  ) {
    return this.repositoriesService.starRepository({
      username,
      slug,
      requesterId: session.user.id,
    });
  }

  @Delete(':username/:slug/star')
  @ApiOperation({
    summary: 'Unstar repository',
    description: "Remove the requester's star from a repository.",
  })
  @ApiOkResponse({
    type: StarRepositoryResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDTO,
  })
  unstarRepository(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession,
  ) {
    return this.repositoriesService.unstarRepository({
      username,
      slug,
      requesterId: session.user.id,
    });
  }

  @Get(':username/:slug/contents')
  @OptionalAuth()
  @ApiOperation({
    summary: 'List repository contents',
    description:
      'One level of a directory at the requested ref - a branch or a commit sha - ' +
      'or the default branch ' +
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
      ref: query.ref,
      requesterId: session?.user?.id,
    });
  }

  @Get(':username/:slug/readme')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Read the README',
    description:
      'The README of a directory - the root of the repository when no `path` is ' +
      'given - at the requested ref.',
  })
  @ApiOkResponse({
    type: GetRepositoryReadmeResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDTO,
  })
  getRepositoryReadme(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
    @Query() query: GetRepositoryReadmeQueryDTO,
  ): Promise<GetRepositoryReadmeResponseDTO> {
    return this.repositoriesService.getRepositoryReadme({
      username,
      repo: slug,
      ref: query.ref,
      path: query.path,
      requesterId: session?.user?.id,
    });
  }

  @Get(':username/:slug/blob')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Read a file',
    description:
      'Contents of a single file at the requested ref - a branch or a commit sha - ' +
      'or the default branch ' +
      'when none is given. Binary files come back base64-encoded, and a file past ' +
      'the inline size limit comes back without contents.',
  })
  @ApiOkResponse({
    type: GetRepositoryBlobResponseDTO,
  })
  @ApiBadRequestResponse({
    description:
      'The `path` query parameter is not a repository-relative file.',
    type: ErrorResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDTO,
  })
  getRepositoryBlob(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
    @Query() query: GetRepositoryBlobQueryDTO,
  ): Promise<GetRepositoryBlobResponseDTO> {
    return this.repositoriesService.getRepositoryBlob({
      username,
      repo: slug,
      path: query.path,
      ref: query.ref,
      requesterId: session?.user?.id,
    });
  }

  @Get(':username/:slug/raw')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Download a file',
    description:
      'The raw bytes of a file. Images, audio, video and PDFs are served inline ' +
      'for the browser to render; everything else downloads.',
  })
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  async getRawBlob(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
    @Query() query: GetRepositoryBlobQueryDTO,
    @Res({ passthrough: true }) response: Response,
  ): Promise<StreamableFile> {
    const blob = await this.repositoriesService.getRawBlob({
      username,
      repo: slug,
      path: query.path,
      ref: query.ref,
      requesterId: session?.user?.id,
    });

    response.set({
      'Content-Type': blob.type,
      'Content-Length': String(blob.size),
      'Content-Disposition': `${blob.inline ? 'inline' : 'attachment'}; filename="${encodeURIComponent(blob.filename)}"`,
      // the bytes are user-controlled: never sniffed, never scripted
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      // content is addressed by commit-stable oid, so a hit can never be stale
      'Cache-Control': 'private, max-age=31536000, immutable',
      ETag: `"${blob.oid}"`,
    });

    return new StreamableFile(blob.stream);
  }

  @Get(':username/:slug/commits')
  @OptionalAuth()
  @ApiOperation({
    summary: 'List commits',
    description:
      'History of a branch or commit, newest first, optionally narrowed to one path. ' +
      'Pages are cursor-based: pass a response `nextCursor` back as `cursor`.',
  })
  @ApiOkResponse({
    type: GetRepositoryCommitsResponseDTO,
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  getRepositoryCommits(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
    @Query() query: GetRepositoryCommitsQueryDTO,
  ): Promise<GetRepositoryCommitsResponseDTO> {
    return this.repositoriesService.getRepositoryCommits({
      username,
      repo: slug,
      requesterId: session?.user?.id,
      query,
    });
  }

  @Get(':username/:slug/commits/:sha')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Read a commit',
    description:
      'One commit with the paths it changed, against its first parent. ' +
      'Accepts a full sha or any unambiguous prefix.',
  })
  @ApiOkResponse({
    type: GetRepositoryCommitResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  getRepositoryCommit(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Param('sha') sha: string,
    @Session() session: UserSession | undefined,
  ): Promise<GetRepositoryCommitResponseDTO> {
    return this.repositoriesService.getRepositoryCommit({
      username,
      repo: slug,
      sha,
      requesterId: session?.user?.id,
    });
  }

  @Get(':username/:slug/commits/:sha/patch')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Read a commit as a patch',
    description: 'The commit as a git patch file, unparsed.',
  })
  @ApiOkResponse({
    content: {
      'text/x-patch': {
        example: '',
      },
    },
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  async getCommitPatch(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Param('sha') sha: string,
    @Query() query: GetCommitPatchQueryDTO,
    @Session() session: UserSession | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<string> {
    const patch = await this.repositoriesService.getCommitPatch({
      username,
      repo: slug,
      sha,
      path: query.path,
      requesterId: session?.user?.id,
    });

    response.set({
      'Content-Type': 'text/x-patch; charset=utf-8',
      'Content-Disposition': `inline; filename="${sha}.patch"`,
      'X-Content-Type-Options': 'nosniff',
    });

    return patch;
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

  @Get(':username/:slug/languages')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Language breakdown',
    description: 'Bytes per language on the default branch, largest first',
  })
  @ApiOkResponse({
    type: GetRepositoryLanguagesResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  @ApiInternalServerErrorResponse({
    type: ErrorResponseDTO,
  })
  getRepositoryLanguages(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
  ): Promise<GetRepositoryLanguagesResponseDTO> {
    return this.repositoriesService.getRepositoryLanguages({
      username,
      repo: slug,
      requesterId: session?.user?.id,
    });
  }
  @Get(':username/:slug/stargazers')
  @OptionalAuth()
  @ApiOperation({
    summary: 'List stargazers',
    description:
      'Who starred the repository, most recently first. Pages are cursor-based: ' +
      'pass a response `nextCursor` back as `cursor`.',
  })
  @ApiOkResponse({
    type: GetRepositoryStargazersResponseDTO,
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  getRepositoryStargazers(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
    @Query() query: GetRepositoryStargazersQueryDTO,
  ): Promise<GetRepositoryStargazersResponseDTO> {
    return this.repositoriesService.getRepositoryStargazers({
      username,
      repo: slug,
      requesterId: session?.user?.id,
      query,
    });
  }

  @Get(':username/:slug/forks')
  @OptionalAuth()
  @ApiOperation({
    summary: 'List forks',
    description:
      'Forks of the repository, newest push first. A private fork is only listed ' +
      'to its own owner.',
  })
  @ApiOkResponse({
    type: GetRepositoryForksResponseDTO,
  })
  @ApiBadRequestResponse({
    type: ErrorResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  getRepositoryForks(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
    @Query() query: GetRepositoryForksQueryDTO,
  ): Promise<GetRepositoryForksResponseDTO> {
    return this.repositoriesService.getRepositoryForks({
      username,
      repo: slug,
      requesterId: session?.user?.id,
      query,
    });
  }

  @Get(':username/:slug/contributors')
  @OptionalAuth()
  @ApiOperation({
    summary: 'List contributors',
    description:
      'Authors of the default branch (or the requested ref), most commits ' +
      'first, with linked Ghost accounts when the commit email matches one.',
  })
  @ApiOkResponse({
    type: GetRepositoryContributorsResponseDTO,
  })
  @ApiNotFoundResponse({
    type: ErrorResponseDTO,
  })
  getRepositoryContributors(
    @Param('username') username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
    @Query() query: GetRepositoryContributorsQueryDTO,
  ): Promise<GetRepositoryContributorsResponseDTO> {
    return this.repositoriesService.getRepositoryContributors({
      username,
      repo: slug,
      requesterId: session?.user?.id,
      query,
    });
  }
}
