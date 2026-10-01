import type { ExecutionContext } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { ImporterSecretGuard } from './importer-secret.guard.js';

const configured = new ConfigService({
  IMPORTER_URL: 'http://importer:3004',
  IMPORTER_SECRET: 'secret',
  GITHUB_CLIENT_ID: 'id',
  GITHUB_CLIENT_SECRET: 'client-secret',
});

function context(authorization?: string) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization } }),
    }),
  } as unknown as ExecutionContext;
}

describe('ImporterSecretGuard', () => {
  it('lets the importer in', () => {
    expect(
      new ImporterSecretGuard(configured).canActivate(context('Bearer secret')),
    ).toBe(true);
  });

  it('refuses a wrong, missing or malformed secret', () => {
    const guard = new ImporterSecretGuard(configured);
    for (const header of ['Bearer wrong', undefined, 'Basic secret']) {
      expect(() => guard.canActivate(context(header))).toThrow(
        UnauthorizedException,
      );
    }
  });

  it('refuses everyone when imports are not configured', () => {
    const guard = new ImporterSecretGuard(new ConfigService({}));
    expect(() => guard.canActivate(context('Bearer secret'))).toThrow(
      UnauthorizedException,
    );
  });
});
