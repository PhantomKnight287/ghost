import { InsufficientScopesError } from '../../lib/github/github.errors.js';
import { hasScope, type Scope } from '../../lib/github/scopes.js';
import type { GithubViewer } from './github-request.js';

/** Refuses unless the viewer's token holds one of `anyOf`; `field` names the GraphQL field or REST route in GitHub's message. */
export function requireScope(viewer: GithubViewer, field: string, ...anyOf: Scope[]) {
  if (!anyOf.some((scope) => hasScope(viewer.scopes, scope))) throw new InsufficientScopesError(field, anyOf, viewer.scopes);
}

/** A write to a repository needs `repo`, or `public_repo` when the repository is public. */
export function requireWriteScope(viewer: GithubViewer, field: string, repository: { isPrivate: boolean }) {
  if (repository.isPrivate) requireScope(viewer, field, 'repo');
  else requireScope(viewer, field, 'repo', 'public_repo');
}
