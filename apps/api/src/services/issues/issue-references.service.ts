import { type Database, schema } from '@ghost/db';
import { parseReferences } from '@ghost/references';
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, notInArray, or, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import { DATABASE } from '../../database/database.module.js';
import type { Commit } from '../../lib/git/commits/list-commits.js';
import { closeIssue, type Executor } from '../../lib/issues/close-issue.js';
import { isoTimestamp } from '../../utils/index.js';
import {
  acceptedCollaboration,
  type Actor,
  canAccess,
  type Repository,
  roleOf,
} from '../git/repository-access/repository-access.service.js';

type SourceType = (typeof schema.issueReferenceSource.enumValues)[number];

export interface ReferenceSource {
  type: SourceType;
  /** The issue id, comment id or commit sha the text lives in. */
  id: string;
  repository: Pick<Repository, 'id'>;
  /** The issue or pull request the text belongs to; null for a commit. */
  issueId: string | null;
  actorId: string | null;
}

const sourceIssue = alias(schema.issue, 'source_issue');
const sourceRepository = alias(schema.repository, 'source_repository');
const sourceOwner = alias(schema.user, 'source_owner');
const actor = alias(schema.user, 'actor');

@Injectable()
export class IssueReferencesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** Makes the references `source` holds match what `text` says now. A reference that survives an edit keeps its original timestamp. */
  async record(db: Executor, source: ReferenceSource, text: string | null) {
    const targets = await this.resolve(db, source, text ?? '');
    const targetIds = [...targets.keys()];

    await db
      .delete(schema.issueReference)
      .where(
        and(
          eq(schema.issueReference.sourceType, source.type),
          eq(schema.issueReference.sourceId, source.id),
          targetIds.length > 0
            ? notInArray(schema.issueReference.targetIssueId, targetIds)
            : undefined,
        ),
      );
    if (targetIds.length === 0) return;

    await db
      .insert(schema.issueReference)
      .values(
        targetIds.map((targetIssueId) => ({
          sourceType: source.type,
          sourceId: source.id,
          sourceRepositoryId: source.repository.id,
          sourceIssueId: source.issueId,
          targetIssueId,
          closing: targets.get(targetIssueId) ?? false,
          actorId: source.actorId,
        })),
      )
      .onConflictDoUpdate({
        target: [
          schema.issueReference.sourceType,
          schema.issueReference.sourceId,
          schema.issueReference.targetIssueId,
        ],
        set: { closing: sql`excluded."closing"` },
      });
  }

  /** Records what each commit message references, attributed to whoever pushed or merged it. */
  async recordCommits(
    db: Executor,
    {
      repository,
      actorId,
      commits,
    }: {
      repository: Pick<Repository, 'id'>;
      actorId: string | null;
      commits: Commit[];
    },
  ) {
    for (const commit of commits) {
      await this.record(
        db,
        { type: 'commit', id: commit.sha, repository, issueId: null, actorId },
        `${commit.subject}\n\n${commit.body}`,
      );
    }
  }

  /** Records what pushed commits reference and closes what each promises to, crediting the commit on the closed issue. */
  async closeFromCommits(params: {
    repository: Pick<Repository, 'id'>;
    actorId: string | null;
    commits: Commit[];
  }) {
    await this.db.transaction(async (tx) => {
      await this.recordCommits(tx, params);
      for (const commit of params.commits) {
        await this.closeReferenced(tx, {
          sources: [{ type: 'commit', id: commit.sha }],
          actorId: params.actorId,
          commitSha: commit.sha,
        });
      }
    });
  }

  /** Drops every reference a deleted comment made. */
  async forget(db: Executor, type: SourceType, id: string) {
    await db
      .delete(schema.issueReference)
      .where(
        and(
          eq(schema.issueReference.sourceType, type),
          eq(schema.issueReference.sourceId, id),
        ),
      );
  }

  /** Where `targetIssueId` was mentioned, one entry per issue or commit, limited to sources `viewer` can read. */
  async mentionsOf(targetIssueId: string, viewer: Actor) {
    const rows = await this.db
      .selectDistinctOn(
        [
          sql`coalesce(${schema.issueReference.sourceIssueId}, ${schema.issueReference.sourceId})`,
        ],
        {
          id: schema.issueReference.id,
          sourceType: schema.issueReference.sourceType,
          commitSha: sql<
            string | null
          >`case when ${schema.issueReference.sourceType} = 'commit' then ${schema.issueReference.sourceId} end`,
          actorUsername: sql<string>`coalesce(${actor.username}, '')`,
          createdAt: isoTimestamp(schema.issueReference.createdAt),
          repository: {
            ownerId: sourceRepository.ownerId,
            visibility: sourceRepository.visibility,
            collaboratorRole: schema.repositoryCollaborator.role,
            username: sql<string>`coalesce(${sourceOwner.username}, '')`,
            slug: sourceRepository.slug,
          },
          source: {
            number: sourceIssue.number,
            title: sourceIssue.title,
            state: sourceIssue.state,
            isPullRequest: sourceIssue.isPullRequest,
          },
        },
      )
      .from(schema.issueReference)
      .innerJoin(
        sourceRepository,
        eq(sourceRepository.id, schema.issueReference.sourceRepositoryId),
      )
      .innerJoin(sourceOwner, eq(sourceOwner.id, sourceRepository.ownerId))
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(sourceRepository.id, viewer),
      )
      .leftJoin(
        sourceIssue,
        eq(sourceIssue.id, schema.issueReference.sourceIssueId),
      )
      .leftJoin(actor, eq(actor.id, schema.issueReference.actorId))
      .where(eq(schema.issueReference.targetIssueId, targetIssueId))
      .orderBy(
        sql`coalesce(${schema.issueReference.sourceIssueId}, ${schema.issueReference.sourceId})`,
        asc(schema.issueReference.createdAt),
      );

    return rows
      .filter(({ repository }) =>
        canAccess(
          repository,
          roleOf(repository, repository.collaboratorRole, viewer),
          'read',
        ),
      )
      .map(({ repository: { username, slug }, source, ...row }) => ({
        ...row,
        repository: { username, slug },
        source,
      }));
  }

  /** Closes the open issues these sources promise to close. Pull requests are never closed by keyword, and a target in a repository `actorId` cannot write to stays open. */
  async closeReferenced(
    db: Executor,
    {
      sources,
      actorId,
      sourceIssueId,
      commitSha,
    }: {
      sources: Array<{ type: SourceType; id: string }>;
      actorId: string | null;
      sourceIssueId?: string;
      commitSha?: string;
    },
  ) {
    if (sources.length === 0) return [];

    const writer = actorId ? { userId: actorId } : null;
    const targets = await db
      .select({
        issueId: schema.issue.id,
        repository: {
          ownerId: schema.repository.ownerId,
          visibility: schema.repository.visibility,
          collaboratorRole: schema.repositoryCollaborator.role,
        },
      })
      .from(schema.issueReference)
      .innerJoin(
        schema.issue,
        eq(schema.issue.id, schema.issueReference.targetIssueId),
      )
      .innerJoin(
        schema.repository,
        eq(schema.repository.id, schema.issue.repositoryId),
      )
      .leftJoin(
        schema.repositoryCollaborator,
        acceptedCollaboration(schema.repository.id, writer),
      )
      .where(
        and(
          eq(schema.issueReference.closing, true),
          eq(schema.issue.state, 'open'),
          eq(schema.issue.isPullRequest, false),
          or(
            ...sources.map((source) =>
              and(
                eq(schema.issueReference.sourceType, source.type),
                eq(schema.issueReference.sourceId, source.id),
              ),
            ),
          ),
        ),
      );

    const closed: string[] = [];
    for (const issueId of new Set(
      targets
        .filter(({ repository }) =>
          canAccess(
            repository,
            roleOf(repository, repository.collaboratorRole, writer),
            'write',
          ),
        )
        .map((target) => target.issueId),
    )) {
      if (
        await closeIssue(db, { issueId, actorId, sourceIssueId, commitSha })
      ) {
        closed.push(issueId);
      }
    }
    return closed;
  }

  /** Issue ids `text` points at, each with whether any mention of it closes it. Repositories the author cannot read resolve to nothing, and an issue never references itself. */
  private async resolve(db: Executor, source: ReferenceSource, text: string) {
    const wanted = new Map<
      string,
      { owner: string | null; repo: string | null; numbers: Set<number> }
    >();
    const closing = new Set<string>();
    for (const reference of parseReferences(text)) {
      if (reference.kind !== 'issue') continue;
      const key = `${reference.owner ?? ''}/${reference.repo ?? ''}`;
      const entry = wanted.get(key) ?? {
        owner: reference.owner,
        repo: reference.repo,
        numbers: new Set(),
      };
      entry.numbers.add(reference.number);
      wanted.set(key, entry);
      if (reference.closing) closing.add(`${key}#${reference.number}`);
    }

    const targets = new Map<string, boolean>();
    if (wanted.size === 0) return targets;

    const named = [...wanted.values()].filter(
      (entry): entry is { owner: string; repo: string; numbers: Set<number> } =>
        entry.owner !== null && entry.repo !== null,
    );
    const author = source.actorId ? { userId: source.actorId } : null;
    const repositories = named.length
      ? await db
          .select({
            id: schema.repository.id,
            ownerId: schema.repository.ownerId,
            visibility: schema.repository.visibility,
            collaboratorRole: schema.repositoryCollaborator.role,
            key: sql<string>`${schema.user.username} || '/' || ${schema.repository.slug}`,
          })
          .from(schema.repository)
          .innerJoin(schema.user, eq(schema.user.id, schema.repository.ownerId))
          .leftJoin(
            schema.repositoryCollaborator,
            acceptedCollaboration(schema.repository.id, author),
          )
          .where(
            or(
              ...named.map((entry) =>
                and(
                  eq(schema.user.username, entry.owner),
                  eq(schema.repository.slug, entry.repo),
                ),
              ),
            ),
          )
      : [];

    const repositoryIdOf = new Map(
      repositories
        .filter((repository) =>
          canAccess(
            repository,
            roleOf(repository, repository.collaboratorRole, author),
            'read',
          ),
        )
        .map((repository) => [repository.key, repository.id]),
    );
    repositoryIdOf.set('/', source.repository.id);

    const scopes = [...wanted].flatMap(([key, entry]) => {
      const repositoryId = repositoryIdOf.get(key);
      return repositoryId
        ? [{ key, repositoryId, numbers: entry.numbers }]
        : [];
    });
    if (scopes.length === 0) return targets;

    const issues = await db
      .select({
        id: schema.issue.id,
        repositoryId: schema.issue.repositoryId,
        number: schema.issue.number,
      })
      .from(schema.issue)
      .where(
        or(
          ...scopes.map((scope) =>
            and(
              eq(schema.issue.repositoryId, scope.repositoryId),
              inArray(schema.issue.number, [...scope.numbers]),
            ),
          ),
        ),
      );

    for (const issue of issues) {
      if (issue.id === source.issueId) continue;
      // The same issue can be written as `#1` and `me/repo#1`; either spelling closing it is enough.
      const isClosing = scopes.some(
        (scope) =>
          scope.repositoryId === issue.repositoryId &&
          closing.has(`${scope.key}#${issue.number}`),
      );
      targets.set(issue.id, (targets.get(issue.id) ?? false) || isClosing);
    }
    return targets;
  }
}
