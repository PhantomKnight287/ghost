import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { OptionalAuth } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';

import { LFS_MEDIA_TYPE } from '../lib/git/lfs/lfs-objects.js';
import { LfsLocksService } from '../services/git/lfs/lfs-locks.service.js';
import {
  CreateLfsLockDTO,
  LfsLocksPageDTO,
  ListLfsLocksQueryDTO,
  UnlockLfsLockDTO,
} from './dto/lfs-locks.dto.js';
import type { GitAuthorizedRequest } from './types.js';

/** Git LFS's locking API. `GitBasicAuthMiddleware` has already authorized the repository: reads for the list, writes for the rest, so every POST has an actor. */
@Controller(':username/:repo/info/lfs/locks')
@ApiExcludeController()
@OptionalAuth()
export class LfsLocksController {
  constructor(private readonly locks: LfsLocksService) {}

  @Get()
  @Header('Content-Type', LFS_MEDIA_TYPE)
  list(@Query() query: ListLfsLocksQueryDTO, @Req() req: GitAuthorizedRequest) {
    return this.locks.list(req.repository.id, query);
  }

  @Post()
  @Header('Content-Type', LFS_MEDIA_TYPE)
  async create(
    @Body() body: CreateLfsLockDTO,
    @Req() req: GitAuthorizedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { lock, created } = await this.locks.create(
      req.repository.id,
      req.actor!.userId,
      body.path,
    );
    if (created) return { lock };
    res.status(HttpStatus.CONFLICT);
    return { lock, message: 'Lock already exists' };
  }

  @Post('verify')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', LFS_MEDIA_TYPE)
  verify(@Body() body: LfsLocksPageDTO, @Req() req: GitAuthorizedRequest) {
    return this.locks.verify(req.repository.id, req.actor!.userId, body);
  }

  @Post(':id/unlock')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', LFS_MEDIA_TYPE)
  unlock(
    @Param('id') id: string,
    @Body() body: UnlockLfsLockDTO,
    @Req() req: GitAuthorizedRequest,
  ) {
    return this.locks.unlock(req.repository, req.actor!.userId, id, body.force);
  }
}
