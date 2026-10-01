import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthService } from '@thallesp/nestjs-better-auth';
import { and, eq, ne } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import type { Auth } from '../../lib/auth.js';
import {
  assertGitHubRepositoryReadable,
  listGitHubRepositories,
} from '../../lib/imports/github.js';
import { githubImportConfig } from '../../lib/imports/importer.js';
import {
  GitHubImportsDisabledError,
  GitHubNotConnectedError,
  ImportNotFailedError,
  ImportNotFoundError,
  ImportRetryWouldOverwriteError,
} from '../../lib/imports/imports.errors.js';
import {
  githubAccessToken,
  githubAccountIdOf,
} from '../../lib/imports/github-account.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { ImportDispatcherService } from '../../services/imports/import-dispatcher.service.js';
import { isoTimestamp } from '../../utils/index.js';
import { RepositoriesService } from '../repositories/repositories.service.js';
import type { StartImportRequestDTO } from './dto/import.dto.js';

@Injectable()
export class ImportsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly auth: AuthService<Auth>,
    private readonly repositories: RepositoriesService,
    private readonly access: RepositoryAccessService,
    private readonly dispatcher: ImportDispatcherService,
  ) {}

  async githubStatus(userId: string) {
    return {
      enabled: Boolean(githubImportConfig(this.config)),
      connected: Boolean(await githubAccountIdOf(this.db, userId)),
    };
  }

  async githubRepositories(userId: string) {
    return {
      repositories: await listGitHubRepositories(
        await this.githubToken(userId),
      ),
    };
  }

  async start(
    { source, ...repository }: StartImportRequestDTO,
    userId: string,
  ) {
    await assertGitHubRepositoryReadable(
      await this.githubToken(userId),
      source,
    );

    const created = await this.repositories.createRepository(
      repository,
      userId,
    );
    await this.db.insert(schema.repositoryImport).values({
      repositoryId: created.id,
      requestedById: userId,
      source,
    });
    this.dispatcher.wake();
    return created;
  }

  async status({
    username,
    repo,
    requesterId,
  }: {
    username: string;
    repo: string;
    requesterId?: string;
  }) {
    const repository = await this.access.authorize({
      username,
      repo,
      actor: requesterId ? { userId: requesterId } : null,
      operation: 'read',
    });
    const [row] = await this.db
      .select({
        status: schema.repositoryImport.status,
        source: schema.repositoryImport.source,
        attempts: schema.repositoryImport.attempts,
        lastError: schema.repositoryImport.lastError,
        createdAt: isoTimestamp(schema.repositoryImport.createdAt),
        updatedAt: isoTimestamp(schema.repositoryImport.updatedAt),
      })
      .from(schema.repositoryImport)
      .where(eq(schema.repositoryImport.repositoryId, repository.id));
    if (!row) throw new ImportNotFoundError();
    return row;
  }

  async retry({
    username,
    repo,
    requesterId,
  }: {
    username: string;
    repo: string;
    requesterId: string;
  }) {
    const repository = await this.access.authorize({
      username,
      repo,
      actor: { userId: requesterId },
      operation: 'admin',
    });
    if (!(await githubAccountIdOf(this.db, requesterId))) {
      throw new GitHubNotConnectedError();
    }
    const [localIssue] = await this.db
      .select({ id: schema.issue.id })
      .from(schema.issue)
      .where(
        and(
          eq(schema.issue.repositoryId, repository.id),
          ne(schema.issue.authorId, schema.IMPORTER_USER_ID),
        ),
      )
      .limit(1);
    if (localIssue) throw new ImportRetryWouldOverwriteError();

    const [row] = await this.db
      .update(schema.repositoryImport)
      .set({
        status: 'pending',
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        // Whoever retries is whose GitHub token and push access the next attempt uses.
        requestedById: requesterId,
      })
      .where(
        and(
          eq(schema.repositoryImport.repositoryId, repository.id),
          eq(schema.repositoryImport.status, 'failed'),
        ),
      )
      .returning({ id: schema.repositoryImport.id });
    if (!row) {
      const [existing] = await this.db
        .select({ id: schema.repositoryImport.id })
        .from(schema.repositoryImport)
        .where(eq(schema.repositoryImport.repositoryId, repository.id));
      throw existing ? new ImportNotFailedError() : new ImportNotFoundError();
    }
    this.dispatcher.wake();
  }

  private async githubToken(userId: string) {
    if (!githubImportConfig(this.config))
      throw new GitHubImportsDisabledError();
    const token = await githubAccessToken(this.db, this.auth, userId);
    if (!token) throw new GitHubNotConnectedError();
    return token;
  }
}
