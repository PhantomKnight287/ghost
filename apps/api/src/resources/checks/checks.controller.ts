import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Session,
} from '@nestjs/common';
import {
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { SignInOptional } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import { TransformToLowercasePipe } from '../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';
import { ChecksService } from './checks.service.js';
import {
  CheckAnnotationsPageDTO,
  CheckAnnotationsQueryDTO,
} from './dto/check.dto.js';

/** What the web reads and presses on check runs; apps create and update them through the GitHub REST layer. */
@Controller('repositories/:username/:repo')
@ApiTags('Checks')
export class ChecksController {
  constructor(private readonly checks: ChecksService) {}

  @Get('check-runs/:id/annotations')
  @SignInOptional()
  @ApiOperation({
    summary: "A check run's annotations, in the order its app sent them",
  })
  @ApiOkResponse({ type: CheckAnnotationsPageDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  annotations(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo') repo: string,
    @Param('id') id: string,
    @Query() query: CheckAnnotationsQueryDTO,
    @Session() session: UserSession | undefined,
  ): Promise<CheckAnnotationsPageDTO> {
    return this.checks.annotations(
      { username, repo, requesterId: session?.user?.id },
      id,
      { offset: query.offset ?? 0, limit: query.limit ?? 100 },
    );
  }

  @Post('check-runs/:id/rerequest')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Re-run a check run',
    description:
      "Needs write access. The run's app hears `check_run.rerequested` and answers with a new run of the same name.",
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({
    description: 'The app is deleted, uninstalled or suspended.',
    type: ErrorResponseDTO,
  })
  async rerequestRun(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo') repo: string,
    @Param('id') id: string,
    @Session() session: UserSession,
  ) {
    await this.checks.rerequestRun(
      { username, repo, requesterId: session.user.id, installation: null },
      id,
    );
  }

  @Post('check-suites/:id/rerequest')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Re-run all of an app's checks on a commit",
    description: 'Needs write access. The app hears `check_suite.rerequested`.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({
    description: 'The app is deleted, uninstalled or suspended.',
    type: ErrorResponseDTO,
  })
  async rerequestSuite(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo') repo: string,
    @Param('id') id: string,
    @Session() session: UserSession,
  ) {
    await this.checks.rerequestSuite(
      { username, repo, requesterId: session.user.id, installation: null },
      id,
    );
  }

  @Post('check-runs/:id/actions/:identifier')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Press one of a check run's action buttons",
    description:
      'Needs write access. The app hears `check_run.requested_action` with the identifier.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnprocessableEntityResponse({
    description: 'The run has no such action, or its app is gone.',
    type: ErrorResponseDTO,
  })
  async requestAction(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo') repo: string,
    @Param('id') id: string,
    @Param('identifier') identifier: string,
    @Session() session: UserSession,
  ) {
    await this.checks.requestAction(
      { username, repo, requesterId: session.user.id },
      id,
      identifier,
    );
  }
}
