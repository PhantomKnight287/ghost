import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  UseFilters,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';
import { GithubRestFilter } from '../github-rest.filter.js';
import { RepositoryResolver } from '../../graphql/resolvers/repository/repository.resolver.js';
import { RepositoryMaterializerService } from '../../../services/git/materializer/repository-materializer.service.js';
import { findReadmePath } from '../../../lib/git/blob/find-readme.js';
import { isTextBlob, readBlob } from '../../../lib/git/blob/read-blob.js';
import { resolveDefaultRef } from '../../../lib/git/tree/resolve-ref.js';
import { Viewer } from '../../auth/viewer.decorator.js';
import type { GithubViewer } from '../../auth/github-request.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { toRepositoryRest } from '../../../lib/github/rest.js';
import { requireWriteScope } from '../../auth/require-scopes.js';
import { RequiresAuthenticationError } from '../../../lib/github/github.errors.js';
import { RepositoriesService } from '../../../resources/repositories/repositories.service.js';
import { GithubCreateRepositoryDTO } from './dto/create-repository.dto.js';

@Controller('v3')
@ApiTags('GitHub compatibility')
@AllowAnonymous()
@UseFilters(GithubRestFilter)
export class ReposController {
  constructor(
    private readonly repositoryNodes: RepositoryResolver,
    private readonly materializer: RepositoryMaterializerService,
    private readonly repositories: RepositoriesService,
    private readonly config: ConfigService,
  ) {}

  @Get('repos/:owner/:repo')
  @ApiOperation({ summary: 'A repository, in GitHub REST shape' })
  async get(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
    const node = await this.repositoryNodes.repository(owner, repo, viewer);
    return toRepositoryRest(node, githubOrigins(this.config));
  }

  @Get('repos/:owner/:repo/readme')
  @ApiOperation({
    summary:
      "The repository's README at the default branch, base64 as GitHub returns it",
  })
  async readme(
    @Param('owner') owner: string,
    @Param('repo') repo: string,
    @Viewer() viewer: GithubViewer | null,
  ) {
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
      throw new NotFoundException();
    return {
      type: 'file',
      encoding: 'base64',
      size: blob.size,
      name: path.split('/').at(-1),
      path,
      content: blob.content.toString('base64'),
    };
  }

  @Post('user/repos')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a repository for the authenticated user' })
  createForUser(
    @Body() body: GithubCreateRepositoryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.create(body, viewer, undefined, 'POST /user/repos');
  }

  @Post('orgs/:org/repos')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a repository in an organization' })
  createForOrganization(
    @Param('org') org: string,
    @Body() body: GithubCreateRepositoryDTO,
    @Viewer() viewer: GithubViewer | null,
  ) {
    return this.create(body, viewer, org, 'POST /orgs/:org/repos');
  }

  private async create(
    body: GithubCreateRepositoryDTO,
    viewer: GithubViewer | null,
    organization: string | undefined,
    route: string,
  ) {
    if (!viewer) throw new RequiresAuthenticationError();
    const visibility = body.visibility ?? (body.private ? 'private' : 'public');
    requireWriteScope(viewer, route, {
      isPrivate: visibility === 'private',
    });
    const created = await this.repositories.createRepository(
      {
        name: body.name,
        description: body.description,
        visibility,
        organization,
      },
      viewer.userId,
    );
    const node = await this.repositoryNodes.load(created.id, viewer);
    return this.get(node.ownerLogin, node.slug, viewer);
  }
}
