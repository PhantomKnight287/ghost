import type { ArchiveFormat } from '../git/archive/archive.js';

export const RELEASE_ASSET_PREFIX = 'release-assets';

export const DEFAULT_RELEASE_ASSET_MAX_BYTES = 2 * 1024 ** 3;

/** A bare `type/subtype`: an asset's type is served back as its `Content-Type`. */
export const MEDIA_TYPE = /^[\w.+-]+\/[\w.+-]+$/;

/** Where an asset's bytes live. A release's or a repository's assets can be removed by prefix. */
export function releaseAssetKey(
  repositoryId: string,
  releaseId?: string,
  assetId?: string,
) {
  return [RELEASE_ASSET_PREFIX, repositoryId, releaseId, assetId]
    .filter(Boolean)
    .join('/')
    .concat(assetId ? '' : '/');
}

/** A file name, never a path: it becomes the last segment of a download URL and the name a browser saves. */
export function isValidAssetName(name: string) {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    name !== '.' &&
    name !== '..' &&
    // no separators, no control characters
    !/[/\\\u0000-\u001f\u007f]/.test(name)
  );
}

/** Where a release's source archive lives: under the release's prefix, so it goes when the release or the repository does. Asset ids start `asset_`, so the names cannot meet. */
export function releaseSourceKey(
  repositoryId: string,
  releaseId: string,
  format: ArchiveFormat,
) {
  return `${releaseAssetKey(repositoryId, releaseId)}source.${format}`;
}
