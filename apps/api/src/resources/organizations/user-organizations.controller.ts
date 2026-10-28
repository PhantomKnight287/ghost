import { Controller, Get, Param, Session } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { SignInOptional } from '../../auth/api-key-auth.guard.js';
import { ErrorResponseDTO } from '../../domain/http.js';
import { ListOrganizationsResponseDTO } from './dto/organization.dto.js';
import { OrganizationsService } from './organizations.service.js';
import { TransformToLowercasePipe } from '../../pipes/transform-to-lowercase/transform-to-lowercase.pipe.js';

@ApiTags('Organizations')
@Controller('users')
export class UserOrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get(':username/organizations')
  @SignInOptional()
  @ApiOperation({
    summary: 'List the organizations a user belongs to',
    description:
      'Membership is private: the user sees all of theirs, anyone else only the ones they share.',
  })
  @ApiOkResponse({ type: ListOrganizationsResponseDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  listForUser(
    @Param('username', TransformToLowercasePipe) username: string,
    @Session() session: UserSession | undefined,
  ): Promise<ListOrganizationsResponseDTO> {
    return this.organizations.listForUser(username, session?.user?.id);
  }
}
