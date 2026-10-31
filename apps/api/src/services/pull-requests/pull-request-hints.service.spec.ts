import type { Database } from '@ghost/db';
import { ConfigService } from '@nestjs/config';
import { describe, expect, it } from 'vitest';

import { ZERO_OID } from '../../lib/git/wal/wal.types.js';
import type { RepositoryMaterializerService } from '../git/materializer/repository-materializer.service.js';
import { PullRequestHintsService } from './pull-request-hints.service.js';

// What a hint says is covered end to end in test/pull-request-hints.e2e-spec.ts; this pins only what a failed lookup does.
describe('PullRequestHintsService', () => {
  it('prints nothing when the lookup fails, rather than failing the push', async () => {
    const db = {
      select: () => {
        throw new Error('database down');
      },
    } as unknown as Database;
    const service = new PullRequestHintsService(
      db,
      {} as RepositoryMaterializerService,
      new ConfigService({ BETTER_AUTH_URL: 'http://127.0.0.1' }),
    );

    await expect(
      service.hintsFor({
        repositoryId: 'repo_ghost',
        repoDirectory: '/repos/ghost.git',
        transitions: [
          {
            ref: 'refs/heads/topic',
            oldOid: ZERO_OID,
            newOid: Buffer.alloc(20, 1),
          },
        ],
      }),
    ).resolves.toEqual([]);
  });
});
