import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { OptionalAuth } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';

import { LFS_MEDIA_TYPE } from '../lib/git/lfs/lfs-objects.js';
import { LfsService } from '../services/git/lfs/lfs.service.js';
import { LfsBatchRequestDTO } from './dto/lfs-batch.dto.js';
import type { GitAuthorizedRequest } from './types.js';

/** Git LFS's batch API and its `basic` transfer. `GitBasicAuthMiddleware` has already authorized the repository for the operation. */
@Controller(':username/:repo/info/lfs/objects')
@ApiExcludeController()
@OptionalAuth()
export class LfsController {
  constructor(private readonly lfs: LfsService) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @Header('Content-Type', LFS_MEDIA_TYPE)
  batch(
    @Param('username') username: string,
    @Body() body: LfsBatchRequestDTO,
    @Req() req: GitAuthorizedRequest,
  ) {
    return this.lfs.batch({
      repositoryId: req.repository.id,
      path: `${username}/${req.repository.slug}`,
      operation: body.operation,
      objects: body.objects,
      authorization: req.headers.authorization,
    });
  }

  @Put(':oid')
  upload(@Param('oid') oid: string, @Req() req: GitAuthorizedRequest) {
    return this.lfs.upload({
      repository: req.repository,
      oid,
      contentLength: req.headers['content-length'],
      body: req,
    });
  }

  @Get(':oid')
  async download(
    @Param('oid') oid: string,
    @Req() req: GitAuthorizedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const object = await this.lfs.download(req.repository.id, oid);
    res.set('Content-Length', String(object.size));
    return new StreamableFile(object.stream, {
      type: 'application/octet-stream',
    });
  }
}
