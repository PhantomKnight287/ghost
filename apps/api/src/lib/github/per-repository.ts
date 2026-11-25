import type { RepositoryNode } from '../../github/graphql/types/repository.type.js';
import type { IssueDTO } from '../../resources/issues/dto/issue.dto.js';

/** Builds each repository's share of `issues` with `build`, which answers in the order given, and returns the results in the order of `issues`. */
export async function perRepository<T>(
  issues: IssueDTO[],
  repositories: Map<string, RepositoryNode>,
  build: (repository: RepositoryNode, issues: IssueDTO[]) => Promise<T[]>,
) {
  const groups = new Map<string, number[]>();
  issues.forEach((issue, index) =>
    groups.set(issue.repositoryId, [
      ...(groups.get(issue.repositoryId) ?? []),
      index,
    ]),
  );
  const results: T[] = [];
  for (const [repositoryId, indexes] of groups) {
    const built = await build(
      repositories.get(repositoryId)!,
      indexes.map((index) => issues[index]!),
    );
    indexes.forEach((index, at) => (results[index] = built[at]!));
  }
  return results;
}
