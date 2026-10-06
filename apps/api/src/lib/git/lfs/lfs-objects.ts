/** What the Git LFS batch API speaks, in both directions. */
export const LFS_MEDIA_TYPE = 'application/vnd.git-lfs+json';

/** Where a repository's LFS objects live, or the prefix holding all of them. */
export function lfsObjectKey(repositoryId: string, oid?: string) {
  return `lfs/${repositoryId}/${oid ?? ''}`;
}

/** A SHA-256 in lowercase hex, the only hash Ghost accepts. It becomes part of an object key, so nothing else may pass. */
export const LFS_OID = /^[0-9a-f]{64}$/;

/** The LFS API of the repository at `owner/repo`, as git-lfs would derive it from the clone URL. */
export function lfsEndpoint(baseUrl: string, path: string) {
  return `${baseUrl}/${path}.git/info/lfs`;
}

/** Where one upload's bytes wait until they are verified. `uploads` can never be an oid, so staging and stored objects share a repository's prefix without colliding. */
export function lfsUploadKey(repositoryId: string, uploadId: string) {
  return `lfs/${repositoryId}/uploads/${uploadId}`;
}
