import type { Readable } from 'node:stream';

import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import {
  GithubNotFoundError,
  GithubValidationError,
  UnprocessableError,
} from '../../../lib/github/github.errors.js';
import { encodeNodeId } from '../../../lib/github/node-id.js';
import {
  releaseAssetExtrasOf,
  releaseNumericIdsOf,
} from '../../../lib/github/node-lookup.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import {
  pageOf,
  RestPage,
  toReleaseAssetRest,
  toReleaseRest,
} from '../../../lib/github/rest.js';
import { MEDIA_TYPE } from '../../../lib/releases/release-assets.js';
import type { ReleaseDTO } from '../../../resources/releases/dto/release.dto.js';
import { ReleaseAssetsService } from '../../../resources/releases/release-assets.service.js';
import { ReleasesService } from '../../../resources/releases/releases.service.js';
import type {
  GithubRepositoryTarget,
  GithubViewer,
} from '../../auth/github-request.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import type { GithubPageQueryDTO } from '../issues/dto/issue.dto.js';
import { GithubIssuesService } from '../issues/issues.service.js';
import type {
  GithubCreateReleaseDTO,
  GithubUpdateReleaseAssetDTO,
  GithubUpdateReleaseDTO,
  GithubUploadReleaseAssetQueryDTO,
} from './dto/release.dto.js';

/** GitHub's REST releases and assets over ReleasesService: its releases plus the integer ids, labels and users GitHub's shapes embed. */
@Injectable()
export class GithubReleasesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly github: GithubIssuesService,
    private readonly releases: ReleasesService,
    private readonly assets: ReleaseAssetsService,
    private readonly config: ConfigService,
  ) {}

  async list(
    { owner, repo, viewer }: GithubRepositoryTarget,
    query: GithubPageQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const { releases, total } = await this.releases.pageReleases({
      ...this.github.ref(repository, viewer),
      offset: page.offset,
      limit: page.perPage,
      order: { field: 'created', direction: 'desc' },
    });
    return new RestPage(await this.rest(repository, releases), page, total);
  }

  /** Ghost has no discussions, so any category is one that does not exist, which GitHub answers with 404; nor can it generate notes. */
  async create(
    { owner, repo, viewer }: GithubRepositoryTarget,
    body: GithubCreateReleaseDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/releases',
    );
    if (body.discussion_category_name !== undefined)
      throw new GithubNotFoundError();
    if (body.generate_release_notes)
      throw new GithubValidationError([
        {
          resource: 'Release',
          field: 'generate_release_notes',
          code: 'invalid',
        },
      ]);
    const created = await this.releases.createRelease({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      body: {
        tagName: body.tag_name,
        target: body.target_commitish,
        name: body.name,
        body: body.body,
        isDraft: body.draft,
        isPrerelease: body.prerelease,
      },
    });
    return this.one(repository, created);
  }

  async latest({ owner, repo, viewer }: GithubRepositoryTarget) {
    const repository = await this.github.readable(owner, repo, viewer);
    return this.one(
      repository,
      await this.releases.getLatestRelease(this.github.ref(repository, viewer)),
    );
  }

  /** Published releases only, as on GitHub: gh finds a draft by its tag through GraphQL. */
  async byTag(
    { owner, repo, viewer }: GithubRepositoryTarget,
    tagName: string,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const release = await this.releases.getReleaseByTag({
      ...this.github.ref(repository, viewer),
      tagName,
    });
    if (release.isDraft) throw new GithubNotFoundError();
    return this.one(repository, release);
  }

  /** Drafts included for those who can write. */
  async get(
    { owner, repo, viewer }: GithubRepositoryTarget,
    releaseId: number,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    return this.one(
      repository,
      await this.byNumericId(repository, viewer, releaseId),
    );
  }

  async update(
    { owner, repo, viewer }: GithubRepositoryTarget,
    releaseId: number,
    body: GithubUpdateReleaseDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'PATCH /repos/:owner/:repo/releases/:release_id',
    );
    if (body.discussion_category_name !== undefined)
      throw new GithubNotFoundError();
    const current = await this.byNumericId(repository, signedIn, releaseId);
    if (body.tag_name !== undefined && body.tag_name !== current.tagName)
      throw new UnprocessableError(
        'Ghost cannot move a release to another tag',
      );
    const updated = await this.releases.updateRelease({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      id: current.id,
      body: {
        name: body.name,
        body: body.body,
        isDraft: body.draft,
        isPrerelease: body.prerelease,
      },
    });
    return this.one(repository, updated);
  }

  /** The tag stays, as on GitHub; gh deletes it separately through git/refs. */
  async delete(
    { owner, repo, viewer }: GithubRepositoryTarget,
    releaseId: number,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'DELETE /repos/:owner/:repo/releases/:release_id',
    );
    const release = await this.byNumericId(repository, signedIn, releaseId);
    await this.releases.deleteRelease({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      id: release.id,
    });
  }

  async listAssets(
    { owner, repo, viewer }: GithubRepositoryTarget,
    releaseId: number,
    query: GithubPageQueryDTO,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const page = pageOf(query);
    const { assets } = await this.one(
      repository,
      await this.byNumericId(repository, viewer, releaseId),
    );
    return new RestPage(
      assets.slice(page.offset, page.offset + page.perPage),
      page,
      assets.length,
    );
  }

  async asset(
    { owner, repo, viewer }: GithubRepositoryTarget,
    assetId: number,
  ) {
    const repository = await this.github.readable(owner, repo, viewer);
    const { release, asset } = await this.assetByNumericId(
      repository,
      viewer,
      assetId,
    );
    return this.assetOf(repository, release, asset.id);
  }

  /** The asset's bytes, counted as a download. */
  async download(
    { owner, repo, viewer }: GithubRepositoryTarget,
    assetId: number,
  ): Promise<{ name: string; size: number; stream: Readable }> {
    const repository = await this.github.readable(owner, repo, viewer);
    const { asset } = await this.assetByNumericId(repository, viewer, assetId);
    return this.assets.download({
      ...this.github.ref(repository, viewer),
      asset: { id: asset.id },
    });
  }

  /** `type` is what the file is served as: the upload's own Content-Type. */
  async upload(
    { owner, repo, viewer }: GithubRepositoryTarget,
    releaseId: number,
    query: GithubUploadReleaseAssetQueryDTO,
    file: {
      type: string | undefined;
      length: string | undefined;
      body: Readable;
    },
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'POST /repos/:owner/:repo/releases/:release_id/assets',
    );
    if (!file.type || !MEDIA_TYPE.test(file.type))
      throw new GithubValidationError([
        { resource: 'ReleaseAsset', field: 'content_type', code: 'invalid' },
      ]);
    const release = await this.byNumericId(repository, signedIn, releaseId);
    const uploaded = await this.assets.upload({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      releaseId: release.id,
      name: query.name,
      label: query.label,
      type: file.type,
      contentLength: file.length,
      body: file.body,
    });
    return this.assetOf(
      repository,
      await this.releases.getRelease({
        ...this.github.ref(repository, signedIn),
        id: release.id,
      }),
      uploaded.id,
    );
  }

  async updateAsset(
    { owner, repo, viewer }: GithubRepositoryTarget,
    assetId: number,
    body: GithubUpdateReleaseAssetDTO,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'PATCH /repos/:owner/:repo/releases/assets/:asset_id',
    );
    const { release, asset } = await this.assetByNumericId(
      repository,
      signedIn,
      assetId,
    );
    await this.assets.update({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      assetId: asset.id,
      name: body.name,
      label: body.label,
    });
    return this.assetOf(
      repository,
      await this.releases.getRelease({
        ...this.github.ref(repository, signedIn),
        id: release.id,
      }),
      asset.id,
    );
  }

  async deleteAsset(
    { owner, repo, viewer }: GithubRepositoryTarget,
    assetId: number,
  ) {
    const { repository, viewer: signedIn } = await this.github.writable(
      owner,
      repo,
      viewer,
      'DELETE /repos/:owner/:repo/releases/assets/:asset_id',
    );
    const { asset } = await this.assetByNumericId(
      repository,
      signedIn,
      assetId,
    );
    await this.assets.delete({
      ...this.github.ref(repository, signedIn),
      requesterId: signedIn.userId,
      assetId: asset.id,
    });
  }

  private async rest(repository: RepositoryNode, releases: ReleaseDTO[]) {
    const assets = releases.flatMap((release) => release.assets);
    const [numericIds, extras] = await Promise.all([
      releaseNumericIdsOf(
        this.db,
        releases.map((release) => release.id),
      ),
      releaseAssetExtrasOf(
        this.db,
        assets.map((asset) => asset.id),
      ),
    ]);
    const context = await this.github.context(repository, {
      logins: [
        ...releases.flatMap((release) => release.authorUsername ?? []),
        ...[...extras.values()].flatMap((asset) => asset.uploaderLogin ?? []),
      ],
      labels: [],
    });
    const uploadUrl = `${githubOrigins(this.config).api}/api/uploads/repos/${repository.nameWithOwner}`;
    return releases.map((release) =>
      toReleaseRest(
        release,
        numericIds.get(release.id)!,
        release.assets.map((asset) =>
          toReleaseAssetRest(
            asset,
            extras.get(asset.id)!,
            release.tagName,
            context,
          ),
        ),
        { uploadUrl, defaultBranch: repository.defaultBranch ?? 'main' },
        context,
      ),
    );
  }

  private async one(repository: RepositoryNode, release: ReleaseDTO) {
    const [rest] = await this.rest(repository, [release]);
    return rest!;
  }

  /** A release by its GitHub id, as the viewer may see it; 404 when it is in another repository or a draft they cannot see. */
  private async byNumericId(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    numericId: number,
  ) {
    const [row] = await this.db
      .select({ id: schema.release.id })
      .from(schema.release)
      .where(
        and(
          eq(schema.release.numericId, numericId),
          eq(schema.release.repositoryId, repository.ghostId),
        ),
      );
    if (!row) throw new GithubNotFoundError();
    return this.releases.getRelease({
      ...this.github.ref(repository, viewer),
      id: row.id,
    });
  }

  /** An asset by its GitHub id, with its release; reading the release is what checks the viewer may see it. */
  private async assetByNumericId(
    repository: RepositoryNode,
    viewer: GithubViewer | null,
    numericId: number,
  ) {
    const [row] = await this.db
      .select({
        id: schema.releaseAsset.id,
        releaseId: schema.releaseAsset.releaseId,
      })
      .from(schema.releaseAsset)
      .where(
        and(
          eq(schema.releaseAsset.numericId, numericId),
          eq(schema.releaseAsset.repositoryId, repository.ghostId),
        ),
      );
    if (!row) throw new GithubNotFoundError();
    const release = await this.releases.getRelease({
      ...this.github.ref(repository, viewer),
      id: row.releaseId,
    });
    const asset = release.assets.find((candidate) => candidate.id === row.id);
    // Still uploading: ReleasesService lists finished assets only.
    if (!asset) throw new GithubNotFoundError();
    return { release, asset };
  }

  /** One asset of `release` in GitHub's shape, by its Ghost id. */
  private async assetOf(
    repository: RepositoryNode,
    release: ReleaseDTO,
    assetId: string,
  ) {
    const nodeId = encodeNodeId('ReleaseAsset', assetId);
    return (await this.one(repository, release)).assets.find(
      (asset) => asset.node_id === nodeId,
    )!;
  }
}
