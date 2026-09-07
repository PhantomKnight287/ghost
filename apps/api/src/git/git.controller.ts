import { Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { OptionalAuth } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';

import { GitService, type GitTransportResponse } from './git.service.js';
import type { GitPackRequest } from './types.js';

@Controller(':username/:repo')
@ApiExcludeController()
@OptionalAuth()
export class GitController {
  constructor(private readonly gitService: GitService) {}

  @Get('info/refs')
  async infoRefs(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Query('service') service: string,
    @Res() res: Response,
  ) {
    this.send(
      res,
      await this.gitService.advertiseRefs({ username, repo, service }),
    );
  }

  @Post('git-upload-pack')
  async uploadPack(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Req() req: GitPackRequest,
    @Res() res: Response,
  ) {
    this.send(
      res,
      await this.gitService.uploadPack({ username, repo, body: req.gitBody }),
    );
  }

  @Post('git-receive-pack')
  async receivePack(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Req() req: GitPackRequest,
    @Res() res: Response,
  ) {
    this.send(
      res,
      await this.gitService.receivePack({
        username,
        repo,
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
