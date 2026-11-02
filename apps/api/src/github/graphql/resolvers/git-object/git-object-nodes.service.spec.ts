import { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { toRefNode } from '../../../../lib/github/nodes.js';
import { CouldNotResolveError } from '../../../../lib/github/github.errors.js';
import type { RepositoryMaterializerService } from '../../../../services/git/materializer/repository-materializer.service.js';
import type { CommitVerificationService } from '../../../../services/gpg/commit-verification.service.js';
import type { RepositoryNodesService } from '../repository/repository-nodes.service.js';
import { GitObjectNodesService } from './git-object-nodes.service.js';

describe('GitObjectNodesService', () => {
  it("answers null for a ref in a repository the viewer cannot read, such as a pull request's private head fork", async () => {
    const open = vi.fn();
    const service = new GitObjectNodesService(
      { open } as unknown as RepositoryMaterializerService,
      {} as CommitVerificationService,
      {
        load: () => Promise.reject(new CouldNotResolveError('hidden')),
      } as unknown as RepositoryNodesService,
      new ConfigService(),
    );
    const context = {
      req: { githubViewer: null },
      loaders: {},
    } as unknown as GraphqlContext;
    const ref = toRefNode('hidden-fork', 'topic');

    await expect(service.refTarget(ref, context)).resolves.toBeNull();
    await expect(service.refCommit(ref, context)).resolves.toBeNull();
    expect(open).not.toHaveBeenCalled();
  });
});
