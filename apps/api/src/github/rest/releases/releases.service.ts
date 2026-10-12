import { type Database, schema } from '@ghost/db';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';

import { DATABASE } from '../../../database/database.module.js';
import { encodeNodeId } from '../../../lib/github/node-id.js';
import {
  releaseAssetExtrasOf,
  releaseNumericIdsOf,
} from '../../../lib/github/node-lookup.js';
import { githubOrigins } from '../../../lib/github/origins.js';
import { toReleaseAssetRest, toReleaseRest } from '../../../lib/github/rest.js';
import type { ReleaseDTO } from '../../../resources/releases/dto/release.dto.js';
import { ReleasesService } from '../../../resources/releases/releases.service.js';
import type { GithubViewer } from '../../auth/github-request.js';
import type { RepositoryNode } from '../../graphql/types/repository.type.js';
import { GithubIssuesService } from '../issues/issues.service.js';

/** GitHub's REST releases and assets over ReleasesService: its releases plus the integer ids, labels and users GitHub's shapes embed. */
@Injectable()
export class GithubReleasesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly github: GithubIssuesService,
    private readonly releases: ReleasesService,
    private readonly config: ConfigService,
  ) {}

  async list(repository: RepositoryNode, releases: ReleaseDTO[]) {
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

  async one(repository: RepositoryNode, release: ReleaseDTO) {
    const [rest] = await this.list(repository, [release]);
    return rest!;
  }

  /** A release by its GitHub id, as the viewer may see it; 404 when it is in another repository or a draft they cannot see. */
  async byNumericId(
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
    if (!row) throw new NotFoundException();
    return this.releases.getRelease({
      ...this.github.ref(repository, viewer),
      id: row.id,
    });
  }

  /** An asset by its GitHub id, with its release; reading the release is what checks the viewer may see it. */
  async assetByNumericId(
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
    if (!row) throw new NotFoundException();
    const release = await this.releases.getRelease({
      ...this.github.ref(repository, viewer),
      id: row.releaseId,
    });
    const asset = release.assets.find((candidate) => candidate.id === row.id);
    // Still uploading: ReleasesService lists finished assets only.
    if (!asset) throw new NotFoundException();
    return { release, asset };
  }

  /** One asset of `release` in GitHub's shape, by its Ghost id. */
  async assetOf(
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
