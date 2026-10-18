import type { Database } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DATABASE } from '../../../database/database.module.js';
import type { ArchiveFormat } from '../../../lib/git/archive/archive.js';
import { findReadmePath } from '../../../lib/git/blob/find-readme.js';
import { isTextBlob, readBlob } from '../../../lib/git/blob/read-blob.js';
import { resolveDefaultRef } from '../../../lib/git/tree/resolve-ref.js';
import {
  GithubNotFoundError,
  RequiresAuthenticationError,
} from '../../../lib/github/github.errors.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { toRepositoryRest } from '../../../lib/github/rest.js';
import { requireOauthAppAllowed } from '../../../lib/organizations/oauth-app-access.js';
import { RepositoriesService } from '../../../resources/repositories/repositories.service.js';
import { RepositoryMaterializerService } from '../../../services/git/materializer/repository-materializer.service.js';
import type {
  GithubRepositoryTarget,
  GithubViewer,
} from '../../auth/github-request.js';
import { requireWriteScope } from '../../auth/require-scopes.js';
import { RepositoryNodesService } from '../../graphql/resolvers/repository/repository-nodes.service.js';
import type { GithubCreateRepositoryDTO } from './dto/create-repository.dto.js';

/** GitHub's REST repositories: reading one, its README, and creating one. */
@Injectable()
export class GithubReposService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly repositoryNodes: RepositoryNodesService,
    private readonly materializer: RepositoryMaterializerService,
    private readonly repositories: RepositoriesService,
    private readonly config: ConfigService,
  ) {}

  async get({ owner, repo, viewer }: GithubRepositoryTarget) {
    const node = await this.repositoryNodes.repository(owner, repo, viewer);
    return toRepositoryRest(node, githubOrigins(this.config));
  }

  /** The README at the default branch, base64 as GitHub returns it. */
  /** GitHub redirects to codeload; Ghost streams from the same host, so the token still applies. */
  async archive({
    owner,
    repo,
    viewer,
    ref,
    format,
  }: GithubRepositoryTarget & { ref?: string; format: ArchiveFormat }) {
    // the GitHub-side checks, an OAuth app an organization has not approved among them
    await this.repositoryNodes.repository(owner, repo, viewer);
    return this.repositories.getArchive({
      username: owner,
      repo,
      ref,
      format,
      requesterId: viewer?.userId,
    });
  }

  async readme({ owner, repo, viewer }: GithubRepositoryTarget) {
    const node = await this.repositoryNodes.repository(owner, repo, viewer);
    const gitDir = await this.materializer.open({
      id: node.ghostId,
      defaultBranch: node.defaultBranch,
    });
    const ref = await resolveDefaultRef({
      gitDir,
      defaultBranch: node.defaultBranch,
    });
    const path = await findReadmePath({ gitDir, ref });
    const blob = path && (await readBlob({ gitDir, ref, path }));
    if (!path || !blob || !isTextBlob(blob.content))
      throw new GithubNotFoundError();
    return {
      type: 'file',
      encoding: 'base64',
      size: blob.size,
      name: path.split('/').at(-1),
      path,
      content: blob.content.toString('base64'),
    };
  }

  /** 404 when the ref has no CODEOWNERS file, as on GitHub. */
  async codeownersErrors({
    owner,
    repo,
    viewer,
    ref,
  }: GithubRepositoryTarget & { ref?: string }) {
    await this.repositoryNodes.repository(owner, repo, viewer);
    const { path, errors } = await this.repositories.getCodeowners({
      username: owner,
      repo,
      ref,
      requesterId: viewer?.userId,
    });
    if (!path) throw new GithubNotFoundError();
    return { errors };
  }

  /** For the viewer, or in `organization`; `route` names the REST route in a missing-scope error. */
  async create(
    viewer: GithubViewer | null,
    body: GithubCreateRepositoryDTO,
    organization: string | undefined,
    route: string,
  ) {
    if (!viewer) throw new RequiresAuthenticationError();
    const visibility = body.visibility ?? (body.private ? 'private' : 'public');
    requireWriteScope(viewer, route, {
      isPrivate: visibility === 'private',
    });
    if (organization && viewer.oauthClientId)
      await requireOauthAppAllowed(this.db, viewer.oauthClientId, organization);
    const created = await this.repositories.createRepository(
      {
        name: body.name,
        description: body.description,
        visibility,
        organization,
        readme: body.auto_init,
        gitignoreTemplate: body.gitignore_template,
        licenseTemplate: body.license_template,
      },
      viewer.userId,
    );
    const node = await this.repositoryNodes.load(created.id, viewer);
    return toRepositoryRest(node, githubOrigins(this.config));
  }
}
