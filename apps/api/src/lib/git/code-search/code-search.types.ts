export interface IndexTarget {
  repositoryId: string;
  /** Visibility is fixed at creation, so the flag baked into a shard never goes stale. */
  isPublic: boolean;
  repoDirectory: string;
}
