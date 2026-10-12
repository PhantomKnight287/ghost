import type { UserSession } from '@thallesp/nestjs-better-auth';
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { UploadNotOctetStreamError } from '../../lib/releases/releases.errors.js';
import { ReleaseAssetsController } from './release-assets.controller.js';
import type { ReleaseAssetsService } from './release-assets.service.js';

describe('ReleaseAssetsController', () => {
  const session = { user: { id: 'user_1' } } as UserSession;
  const upload = vi.fn().mockResolvedValue({ id: 'asset_1' });
  const controller = new ReleaseAssetsController({
    upload,
  } as unknown as ReleaseAssetsService);
  const send = (contentType: string | undefined) =>
    controller.uploadReleaseAsset(
      'owner',
      'repo',
      'release_1',
      { name: 'app.zip', type: 'application/zip' },
      { headers: { 'content-type': contentType } } as unknown as Request,
      session,
    );

  it('streams an octet-stream body to the service', async () => {
    await expect(send('application/octet-stream')).resolves.toEqual({
      id: 'asset_1',
    });
    expect(upload).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'app.zip', type: 'application/zip' }),
    );
  });

  // a JSON or form body has already been parsed away by the time it could be streamed
  it('refuses any other body', () => {
    for (const contentType of ['application/json', undefined])
      expect(() => send(contentType)).toThrow(UploadNotOctetStreamError);
  });
});
