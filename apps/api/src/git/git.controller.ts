import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { OptionalAuth } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';

import { GitService, type GitTransportResponse } from './git.service.js';
import type { GitAuthorizedRequest, GitPackRequest } from './types.js';

@Controller(':username/:repo')
@ApiExcludeController()
@OptionalAuth()
export class GitController {
  constructor(private readonly gitService: GitService) {}

  @Get('info/refs')
  async infoRefs(
    @Query('service') service: string,
    @Req() req: GitAuthorizedRequest,
    @Res() res: Response,
  ) {
    this.send(
      res,
      await this.gitService.advertiseRefs({
        repositoryId: req.repository.id,
        service,
      }),
    );
  }

  @Post('git-upload-pack')
  async uploadPack(
    @Req() req: GitPackRequest & GitAuthorizedRequest,
    @Res() res: Response,
  ) {
    this.send(
      res,
      await this.gitService.uploadPack({
        repositoryId: req.repository.id,
        body: req.gitBody,
      }),
    );
  }

  @Post('git-receive-pack')
  async receivePack(
    @Req() req: GitPackRequest & GitAuthorizedRequest,
    @Res() res: Response,
  ) {
    this.send(
      res,
      await this.gitService.receivePack({
        repositoryId: req.repository.id,
        body: req.gitBody,
        pushedBy: req.actor?.userId ?? null,
      }),
    );
  }

  private send(res: Response, { headers, body }: GitTransportResponse) {
    res.set(headers);
    body.pipe(res);
  }
}
