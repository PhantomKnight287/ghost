import { Controller, Get, Param, Query, Session } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { SignInOptional } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import {
  SuggestedIssuesResponseDTO,
  SuggestedUsersResponseDTO,
  SuggestionQueryDTO,
} from './dto/suggestion.dto.js';
import { SuggestionsService } from './suggestions.service.js';
import { TransformToLowercasePipe } from '../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

@Controller('repositories/:username/:repo/suggestions')
@ApiTags('Issues')
export class SuggestionsController {
  constructor(private readonly suggestions: SuggestionsService) {}

  @Get('users')
  @SignInOptional()
  @ApiOperation({
    summary: 'Suggest people to mention or assign',
    description:
      'Up to eight users whose username starts with `q`, people involved in the repository first.',
  })
  @ApiOkResponse({ type: SuggestedUsersResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  suggestUsers(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Query() query: SuggestionQueryDTO,
    @Session() session: UserSession | undefined,
  ) {
    return this.suggestions.users({
      username,
      repo,
      requesterId: session?.user?.id,
      q: query.q,
    });
  }

  @Get('issues')
  @SignInOptional()
  @ApiOperation({
    summary: 'Suggest issues and pull requests to reference',
    description:
      'Up to eight, newest first, whose number starts with `q` or whose title contains it.',
  })
  @ApiOkResponse({ type: SuggestedIssuesResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  suggestIssues(
    @Param('username', TransformToLowercasePipe) username: string,
    @Param('repo', TransformToLowercasePipe) repo: string,
    @Query() query: SuggestionQueryDTO,
    @Session() session: UserSession | undefined,
  ) {
    return this.suggestions.issues({
      username,
      repo,
      requesterId: session?.user?.id,
      q: query.q,
    });
  }
}
