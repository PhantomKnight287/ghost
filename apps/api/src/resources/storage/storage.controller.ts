import { Controller, Get, Param, Session } from '@nestjs/common';
import {
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import type { UserSession } from '@thallesp/nestjs-better-auth';

import { ErrorResponseDTO } from '../../domain/http.js';
import { StorageUsageDTO } from './dto/storage.dto.js';
import { StorageService } from './storage.service.js';

@Controller('storage')
@ApiTags('Storage')
export class StorageController {
  constructor(private readonly storage: StorageService) {}

  @Get(':owner')
  @ApiOperation({
    summary: 'Storage usage of an account',
    description:
      "Bytes the signed-in user's own account, or an organization they belong to, keeps against each of its quotas: pushed git data and merged pull requests' heads, Git LFS objects, release assets, and forks, which hold all three under one quota.",
  })
  @ApiOkResponse({ type: StorageUsageDTO })
  @ApiNotFoundResponse({ type: ErrorResponseDTO })
  getStorageUsage(
    @Param('owner') owner: string,
    @Session() session: UserSession,
  ): Promise<StorageUsageDTO> {
    return this.storage.usage(owner, session.user.id);
  }
}
