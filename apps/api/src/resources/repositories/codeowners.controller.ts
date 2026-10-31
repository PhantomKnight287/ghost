import { Controller, Get, Param, Query, Session } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { SignInOptional } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import { TransformToLowercasePipe } from '../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';
import {
  GetCodeownersOwnersQueryDTO,
  GetCodeownersOwnersResponseDTO,
  GetCodeownersQueryDTO,
  GetCodeownersResponseDTO,
} from './dto/codeowners.dto.js';
import { RepositoriesService } from './repositories.service.js';

@Controller('repositories')
@ApiTags('Repositories')
export class CodeownersController {
  constructor(private readonly repositoriesService: RepositoriesService) {}

  @Get(':username/:slug/codeowners')
  @SignInOptional()
  @ApiOperation({
    summary: 'Check the CODEOWNERS file',
    description:
      'The CODEOWNERS file in effect at a ref and every error in it: bad syntax, and owners that are unknown or lack write access.',
  })
  @ApiOkResponse({ type: GetCodeownersResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getCodeowners(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
    @Query() query: GetCodeownersQueryDTO,
  ): Promise<GetCodeownersResponseDTO> {
    return this.repositoriesService.getCodeowners({
      username,
      repo: slug,
      ref: query.ref,
      requesterId: session?.user?.id,
    });
  }

  @Get(':username/:slug/codeowners/owners')
  @SignInOptional()
  @ApiOperation({
    summary: 'Name the code owners of files',
    description:
      'The owners of each file under the CODEOWNERS file in effect at a ref, leaving out owners that are unknown or lack write access.',
  })
  @ApiOkResponse({ type: GetCodeownersOwnersResponseDTO })
  @ApiBadRequestResponse({
    description: 'A `path` is not a repository-relative file.',
    type: ErrorResponseDTO,
  })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getCodeownersOwners(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
    @Query() query: GetCodeownersOwnersQueryDTO,
  ): Promise<GetCodeownersOwnersResponseDTO> {
    return this.repositoriesService.getCodeownersOwners({
      username,
      repo: slug,
      paths: query.path,
      ref: query.ref,
      requesterId: session?.user?.id,
    });
  }
}
