export interface IndexTarget {
  repositoryId: string;
  /** Baked into the shards, so a change of visibility needs a reindex just as a new HEAD does. */
  isPublic: boolean;
  repoDirectory: string;
}
