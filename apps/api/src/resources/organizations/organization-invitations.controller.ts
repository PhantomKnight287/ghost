import { Controller, Get, Session } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ListReceivedOrganizationInvitationsResponseDTO } from './dto/organization.dto.js';
import { OrganizationsService } from './organizations.service.js';

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
