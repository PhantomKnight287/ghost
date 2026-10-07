import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, or } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { bufferBody } from '../../lib/git/protocol/git-request-body.js';
import type { AuthorizedRepository } from '../../lib/repositories/access/repository-access.js';
import { isValidRefName } from '../../lib/git/refs/is-valid-ref-name.js';
import { listTags } from '../../lib/git/tags/list-tags.js';
import {
  resolveCommit,
  resolveDefaultRef,
  resolveTargetCommit,
} from '../../lib/git/tree/resolve-ref.js';
import { type RefTransition, ZERO_OID } from '../../lib/git/wal/wal.types.js';
import { BranchesService } from '../../services/git/branches/branches.service.js';
import { RepositoryMaterializerService } from '../../services/git/materializer/repository-materializer.service.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { PushTransactionService } from '../../services/git/wal/push-transaction.service.js';
import { BranchNotFoundError } from '../../lib/repositories/repositories.errors.js';
import type { BranchDTO, CreateBranchRequestDTO } from './dto/branch.dto.js';
import {
  BranchAlreadyExistsError,
  BranchInUseError,
  BranchSourceNotFoundError,
  DefaultBranchDeletionError,
  InvalidBranchNameError,
} from '../../lib/branches/branches.errors.js';

type RepositoryRef = { username: string; repo: string; requesterId: string };

/** Creating and deleting branches from the API. Both are ref-only entries in the log: every object they point at is already there. */
@Injectable()
export class RepositoryBranchesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly branches: BranchesService,
    private readonly pushTransaction: PushTransactionService,
  ) {}

  async createBranch({
    body,
    ...target
  }: RepositoryRef & { body: CreateBranchRequestDTO }): Promise<BranchDTO> {
    const repository = await this.access.authorize({
      ...target,
      operation: 'write',
    });
    if (!isValidRefName('heads', body.name)) {
      throw new InvalidBranchNameError(body.name);
    }

    const directory = await this.materializer.open(repository);
    const [branches, tags] = await Promise.all([
      this.branches.getGitBranches(directory),
      listTags(directory),
    ]);
    if (branches.includes(body.name)) {
      throw new BranchAlreadyExistsError(body.name);
    }

    const from = body.from?.trim();
    const sha = await resolveTargetCommit({
      gitDir: directory,
      defaultBranch: repository.defaultBranch,
      branches,
      tags,
      requested: from,
    });
    if (!sha) {
      throw new BranchSourceNotFoundError(
        from ?? repository.defaultBranch ?? '',
      );
    }

    // A concurrent create of the same name loses the compare-and-swap with a conflict.
    await this.commitRef(repository, target.requesterId, {
      ref: `refs/heads/${body.name}`,
      oldOid: ZERO_OID,
      newOid: Buffer.from(sha, 'hex'),
    });
    return { name: body.name, sha };
  }

  /** Refuses the default branch and any branch an open pull request compares, which would otherwise be left pointing at nothing. */
  async deleteBranch({
    branch,
    ...target
  }: RepositoryRef & { branch: string }) {
    const repository = await this.access.authorize({
      ...target,
      operation: 'write',
    });
    const directory = await this.materializer.open(repository);

    if (!(await this.branches.getGitBranches(directory)).includes(branch)) {
      throw new BranchNotFoundError(branch);
    }
    const ref = `refs/heads/${branch}`;
    const defaultRef = await resolveDefaultRef({
      gitDir: directory,
      defaultBranch: repository.defaultBranch,
    });
    if (ref === defaultRef) throw new DefaultBranchDeletionError(branch);

    const [pullRequest] = await this.db
      .select({ number: schema.issue.number })
      .from(schema.pullRequest)
      .innerJoin(schema.issue, eq(schema.issue.id, schema.pullRequest.issueId))
      .where(
        and(
          eq(schema.pullRequest.state, 'open'),
          or(
            and(
              eq(schema.pullRequest.baseRepositoryId, repository.id),
              eq(schema.pullRequest.baseRef, branch),
            ),
            and(
              eq(schema.pullRequest.headRepositoryId, repository.id),
              eq(schema.pullRequest.headRef, branch),
            ),
          ),
        ),
      )
      .limit(1);
    if (pullRequest) throw new BranchInUseError(branch, pullRequest.number);

    const sha = await resolveCommit(directory, ref);
    if (!sha) throw new BranchNotFoundError(branch);

    // Pinned to the tip read above, so a push that moved the branch in between wins and this fails with a conflict.
    await this.commitRef(repository, target.requesterId, {
      ref,
      oldOid: Buffer.from(sha, 'hex'),
      newOid: ZERO_OID,
    });
  }

  private commitRef(
    repository: AuthorizedRepository,
    requesterId: string,
    transition: RefTransition,
  ) {
    return this.pushTransaction.commitPush({
      repoId: repository.id,
      transitions: [transition],
      body: bufferBody(Buffer.alloc(0)),
      packOffset: 0,
      pushedBy: requesterId,
    });
  }
}
