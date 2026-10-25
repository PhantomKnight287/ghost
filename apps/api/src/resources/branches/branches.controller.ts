import {
  Body,
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Session,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import { BranchDTO, CreateBranchRequestDTO } from './dto/branch.dto.js';
import { RepositoryBranchesService } from './repository-branches.service.js';
import { TransformToLowercasePipe } from '../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

@Controller('repositories/:username/:repo/branches')
@ApiTags('Branches')
export class BranchesController {
  constructor(private readonly branches: RepositoryBranchesService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a branch',
    description:
      'Needs write access. The branch starts at `from`, or at the default branch.',
  })
  @ApiCreatedResponse({ type: BranchDTO })
  @ApiBadRequestResponse({
    description: 'The branch name is not one git accepts.',
    type: ErrorResponseDTO,
  })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({
    description:
      'The repository, or the revision to branch from, does not exist.',
    type: ErrorResponseDTO,
  })
  @ApiConflictResponse({
    description: 'A branch with that name already exists.',
    type: ErrorResponseDTO,
  })
  createBranch(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Body() body: CreateBranchRequestDTO,
    @Session() session: UserSession,
  ): Promise<BranchDTO> {
    return this.branches.createBranch({
      username,
      repo,
      requesterId: session.user.id,
      body,
    });
  }

  @Delete(':branch')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Delete a branch',
    description:
      'Needs write access. A branch containing `/` is sent percent-encoded.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiConflictResponse({
    description:
      'The branch is the default branch, or an open pull request compares it.',
    type: ErrorResponseDTO,
  })
  deleteBranch(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Param('branch') branch: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.branches.deleteBranch({
      username,
      repo,
      branch,
      requesterId: session.user.id,
    });
  }
}
