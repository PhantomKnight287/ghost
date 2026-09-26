import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Req,
  Session,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnsupportedMediaTypeResponse,
} from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import { OptionalAuth, type UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import {
  InviteByUsernameRequestDTO,
  ListOutsideCollaboratorsResponseDTO,
  ListReceivedOrganizationInvitationsResponseDTO,
  OrganizationSettingsDTO,
  SetPinnedRepositoriesDTO,
  UpdateOrganizationSettingsDTO,
  ListMyOrganizationsResponseDTO,
  ListOrganizationsResponseDTO,
  OrganizationProfileDTO,
} from './dto/organization.dto.js';
import { UploadAvatarResponseDTO } from '../user/dto/avatar.dto.js';
import { OrganizationsService } from './organizations.service.js';

@ApiTags('Organizations')
@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my organizations',
    description:
      "Organizations the signed-in user belongs to, with the user's role in each.",
  })
  @ApiOkResponse({ type: ListMyOrganizationsResponseDTO })
  listMine(
    @Session() session: UserSession,
  ): Promise<ListMyOrganizationsResponseDTO> {
    return this.organizations.listMine(session.user.id);
  }

  @Put(':slug/logo')
  @ApiOperation({
    summary: "Upload the organization's logo",
    description:
      'Takes the raw image bytes, PNG or JPEG, and sets them as the logo. Admins only.',
  })
  @ApiConsumes('image/png', 'image/jpeg')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiOkResponse({ type: UploadAvatarResponseDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  @ApiUnsupportedMediaTypeResponse({ type: ErrorResponseDTO })
  setLogo(
    @Param('slug') slug: string,
    @Req() request: Request,
    @Headers('content-type') contentType: string,
    @Session() session: UserSession,
  ): Promise<UploadAvatarResponseDTO> {
    return this.organizations.setLogo({
      slug,
      requesterId: session.user.id,
      contentType: contentType ?? '',
      body: Buffer.isBuffer(request.body) ? request.body : undefined,
    });
  }

  @Get(':slug/settings')
  @ApiOperation({ summary: 'Organization settings. Admins only.' })
  @ApiOkResponse({ type: OrganizationSettingsDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getSettings(
    @Param('slug') slug: string,
    @Session() session: UserSession,
  ): Promise<OrganizationSettingsDTO> {
    return this.organizations.getSettings(slug, session.user.id);
  }

  @Patch(':slug/settings')
  @ApiOperation({
    summary: 'Change organization settings',
    description:
      'Base permission, repository policies and the public profile. Admins only.',
  })
  @ApiOkResponse({ type: OrganizationSettingsDTO })
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  updateSettings(
    @Param('slug') slug: string,
    @Body() body: UpdateOrganizationSettingsDTO,
    @Session() session: UserSession,
  ): Promise<OrganizationSettingsDTO> {
    return this.organizations.updateSettings(slug, session.user.id, body);
  }

  @Put(':slug/public-members')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Make my membership public',
    description:
      "Lists the requester among the organization's public members, and the organization on their profile.",
  })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  publicize(
    @Param('slug') slug: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.organizations.setMembershipPublic(slug, session.user.id, true);
  }

  @Delete(':slug/public-members')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Make my membership private' })
  @ApiNoContentResponse()
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  conceal(
    @Param('slug') slug: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.organizations.setMembershipPublic(slug, session.user.id, false);
  }

  @Put(':slug/pins')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Pin repositories',
    description:
      'Replaces the pinned repositories, up to six, in the order given. Admins only.',
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  setPinned(
    @Param('slug') slug: string,
    @Body() body: SetPinnedRepositoriesDTO,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.organizations.setPinned(
      slug,
      session.user.id,
      body.repositories,
    );
  }

  @Get(':slug/outside-collaborators')
  @ApiOperation({
    summary: 'List outside collaborators',
    description:
      "People with access to the organization's repositories who are not members. Admins only.",
  })
  @ApiOkResponse({ type: ListOutsideCollaboratorsResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  listOutsideCollaborators(
    @Param('slug') slug: string,
    @Session() session: UserSession,
  ): Promise<ListOutsideCollaboratorsResponseDTO> {
    return this.organizations.listOutsideCollaborators(slug, session.user.id);
  }

  @Delete(':slug/outside-collaborators/:username')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove an outside collaborator',
    description:
      'Removes them, and their pending invitations, from every repository of the organization. Admins only.',
  })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  removeOutsideCollaborator(
    @Param('slug') slug: string,
    @Param('username') username: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.organizations.removeOutsideCollaborator(
      slug,
      session.user.id,
      username,
    );
  }

  @Post(':slug/invitations')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Invite a user by username',
    description:
      "Creates the same invitation an email invite would, addressed to the user's email without revealing it. Admins only.",
  })
  @ApiNoContentResponse()
  @ApiBadRequestResponse({ type: ErrorResponseDTO })
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  inviteByUsername(
    @Param('slug') slug: string,
    @Body() body: InviteByUsernameRequestDTO,
    @Req() request: Request,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.organizations.inviteByUsername({
      slug,
      username: body.username,
      role: body.role,
      requesterId: session.user.id,
      headers: fromNodeHeaders(request.headers),
    });
  }

  @Delete(':slug/logo')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Remove the organization's logo. Admins only." })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  removeLogo(
    @Param('slug') slug: string,
    @Session() session: UserSession,
  ): Promise<void> {
    return this.organizations.removeLogo(slug, session.user.id);
  }

  @Get(':slug')
  @OptionalAuth()
  @ApiOperation({
    summary: 'Organization profile',
    description:
      'Public, except that members and the viewer role are only returned to members.',
  })
  @ApiOkResponse({ type: OrganizationProfileDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getProfile(
    @Param('slug') slug: string,
    @Session() session: UserSession | undefined,
  ): Promise<OrganizationProfileDTO> {
    return this.organizations.getProfile(slug, session?.user?.id);
  }
}

@ApiTags('Organizations')
@Controller('users')
export class UserOrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get(':username/organizations')
  @OptionalAuth()
  @ApiOperation({
    summary: 'List the organizations a user belongs to',
    description:
      'Membership is private: the user sees all of theirs, anyone else only the ones they share.',
  })
  @ApiOkResponse({ type: ListOrganizationsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  listForUser(
    @Param('username') username: string,
    @Session() session: UserSession | undefined,
  ): Promise<ListOrganizationsResponseDTO> {
    return this.organizations.listForUser(username, session?.user?.id);
  }
}

@ApiTags('Organizations')
@Controller('invitations/organizations')
export class OrganizationInvitationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List my organization invitations',
    description:
      "Pending invitations to organizations, addressed to the signed-in account's email. Accept or reject them through Better Auth's organization endpoints.",
  })
  @ApiOkResponse({ type: ListReceivedOrganizationInvitationsResponseDTO })
  list(
    @Session() session: UserSession,
  ): Promise<ListReceivedOrganizationInvitationsResponseDTO> {
    return this.organizations.listReceivedInvitations(session.user.id);
  }
}
