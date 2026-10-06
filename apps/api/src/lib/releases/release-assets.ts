/** Bucket prefix every release asset lives under. */
export const RELEASE_ASSET_PREFIX = 'release-assets';

export const DEFAULT_RELEASE_ASSET_MAX_BYTES = 2 * 1024 ** 3;

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
