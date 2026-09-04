import { Controller, Get, Param, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { OptionalAuth } from '@thallesp/nestjs-better-auth';
import type { Response } from 'express';

import { bufferBody } from '../services/git/protocol/git-request-body.js';
import { GitService, type GitTransportResponse } from './git.service.js';
import type { GitRequest } from './middleware/git-raw-body.middleware.js';

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
    this.send(res, await this.gitService.advertiseRefs({ username, repo, service }));
  }

  @Post('git-upload-pack')
  async uploadPack(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Req() req: GitRequest,
    @Res() res: Response,
  ) {
    this.send(
      res,
      await this.gitService.uploadPack({ username, repo, body: bodyOf(req) }),
    );
  }

  @Post('git-receive-pack')
  async receivePack(
    @Param('username') username: string,
    @Param('repo') repo: string,
    @Req() req: GitRequest,
    @Res() res: Response,
  ) {
    this.send(
      res,
      await this.gitService.receivePack({ username, repo, body: bodyOf(req) }),
    );
  }

  private send(res: Response, { headers, body }: GitTransportResponse) {
    res.set(headers);
    body.pipe(res);
  }
}

/** GitRawBodyMiddleware has already spooled the socket; see its comment for why. */
function bodyOf(req: GitRequest) {
  return req.gitBody ?? bufferBody(Buffer.alloc(0));
}
