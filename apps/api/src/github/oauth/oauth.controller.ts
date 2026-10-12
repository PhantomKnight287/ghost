import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import type { Request, Response } from 'express';

import { sendOAuth } from '../../lib/github/oauth-response.js';
import {
  type AccessTokenRequest,
  type AuthorizeQuery,
  OauthService,
} from './oauth.service.js';

/** GitHub's OAuth flows at its own paths. Each answers form-encoded or JSON, as the client's Accept header asks. */
@Controller('login')
@ApiExcludeController()
@AllowAnonymous()
export class OauthController {
  constructor(private readonly oauth: OauthService) {}

  /** A refusal is a page, fixed text only: nothing from the request reaches it. */
  @Get('oauth/authorize')
  async authorize(@Query() query: AuthorizeQuery, @Res() res: Response) {
    const result = await this.oauth.authorize(query);
    if ('redirect' in result) return res.redirect(302, result.redirect);
    res
      .status(400)
      .type('html')
      .send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Authorization failed</title></head><body><h1>Authorization failed</h1><p>${result.refused}</p></body></html>`,
      );
  }

  @Post('device/code')
  async deviceCode(
    @Body() body: { client_id?: string; scope?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    sendOAuth(req, res, await this.oauth.deviceCode(body));
  }

  @Post('oauth/access_token')
  async accessToken(
    @Body() body: AccessTokenRequest,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    sendOAuth(req, res, await this.oauth.accessToken(body));
  }
}
