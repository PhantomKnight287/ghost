import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

import { githubImportConfig } from '../../lib/imports/importer.js';

/** The importer's callbacks carry the secret the API sent its jobs with. */
@Injectable()
export class ImporterSecretGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext) {
    const secret = githubImportConfig(this.config)?.importerSecret;
    const header = context.switchToHttp().getRequest<Request>()
      .headers.authorization;
    if (!secret || !header?.startsWith('Bearer '))
      throw new UnauthorizedException();

    // Hashing first gives both sides one length, which `timingSafeEqual` needs.
    const given = createHash('sha256').update(header.slice(7)).digest();
    const expected = createHash('sha256').update(secret).digest();
    if (!timingSafeEqual(given, expected)) throw new UnauthorizedException();
    return true;
  }
}
