import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Session,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import {
  ListOrganizationTeamsResponseDTO,
  OrganizationTeamDTO,
} from './dto/organization.dto.js';
import { TeamsService } from './teams.service.js';

@ApiTags('Organizations')
@Controller('organizations/:slug/teams')
export class OrganizationTeamsController {
  constructor(private readonly teams: TeamsService) {}

  @Get()
  @ApiOperation({ summary: 'List teams', description: 'Members only.' })
  @ApiOkResponse({ type: ListOrganizationTeamsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  list(
    @Param('slug') slug: string,
    @Session() session: UserSession,
  ): Promise<ListOrganizationTeamsResponseDTO> {
    return this.teams.list(slug, session.user.id);
  }

  @Get(':team')
  @ApiOperation({
    summary: 'Read a team',
    description:
      'Its members, its maintainers and the repositories it reaches. Members only.',
  })
  @ApiOkResponse({ type: OrganizationTeamDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  get(
    @Param('slug') slug: string,
    @Param('team') team: string,
    @Session() session: UserSession,
  ): Promise<OrganizationTeamDTO> {
    return this.teams.get(slug, team, session.user.id);
  }

  @Put(':team/members/:username')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Add a member to a team',
    description:
      'Takes a member of the organization. Admins and the team maintainers only.',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  addMember(
    @Param('slug') slug: string,
    @Param('team') team: string,
    @Param('username') username: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.teams.addMember(slug, team, username, session.user.id);
  }

  @Delete(':team/members/:username')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a member from a team',
    description: 'Admins and the team maintainers only.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  removeMember(
    @Param('slug') slug: string,
    @Param('team') team: string,
    @Param('username') username: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.teams.removeMember(slug, team, username, session.user.id);
  }

  @Put(':team/maintainers/:username')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Make a team member a maintainer',
    description: "A maintainer manages the team's members. Admins only.",
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  appoint(
    @Param('slug') slug: string,
    @Param('team') team: string,
    @Param('username') username: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.teams.setMaintainer(
      slug,
      team,
      username,
      session.user.id,
      true,
    );
  }

  @Delete(':team/maintainers/:username')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Stop a member maintaining a team. Admins only.' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  dismiss(
    @Param('slug') slug: string,
    @Param('team') team: string,
    @Param('username') username: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.teams.setMaintainer(
      slug,
      team,
      username,
      session.user.id,
      false,
    );
  }
}
