import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

import { secretsMatch } from '../../lib/http/secrets-match.js';
import { githubImportConfig } from '../../lib/imports/importer.js';

/** The importer's callbacks carry the secret the API sent its jobs with. */
@Injectable()
export class ImporterSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const secret = githubImportConfig(this.config)?.importerSecret;
    const header = context.switchToHttp().getRequest<Request>()
      .headers.authorization;
    if (
      !header?.startsWith('Bearer ') ||
      !secretsMatch(header.slice(7), secret)
    )
      throw new UnauthorizedException();
    return true;
  }
}
