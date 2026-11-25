import { schema } from '@ghost/db';
import { and, eq, isNull, not, or } from 'drizzle-orm';

import type { GithubViewer } from '../../github/auth/github-request.js';
import { oauthAppBlockedIn } from '../organizations/oauth-app-access.js';
import { hasScope } from './scopes.js';

/** What a token cannot reach of the repositories its user may read, as a condition over `repository`: a token without `repo` sees no private ones, and an OAuth app an organization keeps out sees none of its. */
export function tokenReaches(viewer: GithubViewer | null) {
  return and(
    viewer && !hasScope(viewer.scopes, 'repo')
      ? eq(schema.repository.visibility, 'public')
      : undefined,
    viewer?.oauthClientId
      ? or(
          isNull(schema.repository.organizationId),
          not(
            oauthAppBlockedIn(
              schema.repository.organizationId,
              viewer.oauthClientId,
            ),
          ),
        )
      : undefined,
  );
}
