import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNotNull, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { RepositoryAccessService } from '../../services/git/repository-access/repository-access.service.js';
import { escapeLike } from '../../lib/db/sql.js';

const LIMIT = 8;

type SuggestionRef = {
  username: string;
  repo: string;
  requesterId?: string;
  q?: string;
};

/** What the Markdown editor and the assignee picker offer as someone types `@`, `#` or a name. */
@Injectable()
export class SuggestionsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: RepositoryAccessService,
  ) {}

  /** People whose username starts with `q`, those involved in the repository first. With nothing typed, only the involved: its owner, collaborators, organization members and everyone who opened or commented on an issue in it. */
  async users({ q, ...target }: SuggestionRef) {
    const repository = await this.access.authorize(target);
    const involved = sql<boolean>`${schema.user.id} in (
      select ${repository.ownerId}::text
      union select user_id from repository_collaborator where repository_id = ${repository.id} and accepted_at is not null
      union select user_id from member where organization_id = ${repository.organizationId}
      union select author_id from issue where repository_id = ${repository.id}
      union select c.author_id from issue_comment c join issue i on i.id = c.issue_id where i.repository_id = ${repository.id}
    )`;
    const prefix = q?.trim();

    const users = await this.db
      .select({
        username: sql<string>`${schema.user.username}`,
        name: schema.user.name,
        image: schema.user.image,
      })
      .from(schema.user)
      .where(
        and(
          isNotNull(schema.user.username),
          prefix
            ? ilike(schema.user.username, `${escapeLike(prefix)}%`)
            : involved,
        ),
      )
      .orderBy(desc(involved), asc(schema.user.username))
      .limit(LIMIT);
    return { users };
  }

  /** Issues and pull requests whose number starts with `q`, or whose title contains it; newest first. */
  async issues({ q, ...target }: SuggestionRef) {
    const repository = await this.access.authorize(target);
    const query = q?.trim();

    const issues = await this.db
      .select({
        number: schema.issue.number,
        title: schema.issue.title,
        state: schema.issue.state,
        isPullRequest: schema.issue.isPullRequest,
      })
      .from(schema.issue)
      .where(
        and(
          eq(schema.issue.repositoryId, repository.id),
          !query
            ? undefined
            : /^\d+$/.test(query)
              ? sql`${schema.issue.number}::text like ${`${query}%`}`
              : ilike(schema.issue.title, `%${escapeLike(query)}%`),
        ),
      )
      .orderBy(desc(schema.issue.number))
      .limit(LIMIT);
    return { issues };
  }
}
