import { type Database, schema } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { DATABASE } from '../../database/database.module.js';
import { excluded } from '../../lib/db/sql.js';
import { attributed } from '../../lib/imports/attribution.js';
import type { Executor } from '../../lib/db/executor.js';
import type {
  ImportedCommentDTO,
  ImportedIssueDTO,
  ImportedReleaseDTO,
} from '../../resources/imports/dto/importer-callback.dto.js';

const IMPORTER = schema.IMPORTER_USER_ID;

/**
 * Writes what the importer read from GitHub. Every write is an upsert keyed the way GitHub keys it (tag name, issue number), so a retried attempt overwrites the previous one instead of duplicating it.
 *
 * Nothing here publishes events: an import is history, not activity, and thousands of `issue.opened` webhooks for it would be noise.
 */
@Injectable()
export class ImportWriterService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async writeReleases(repositoryId: string, releases: ImportedReleaseDTO[]) {
    if (!releases.length) return;
    await this.db
      .insert(schema.release)
      .values(
        releases.map((release) => ({
          repositoryId,
          tagName: release.tagName,
          name: release.name,
          body: release.body,
          isDraft: release.isDraft,
          isPrerelease: release.isPrerelease,
          authorId: IMPORTER,
          createdAt: new Date(release.createdAt),
          publishedAt: release.publishedAt
            ? new Date(release.publishedAt)
            : null,
        })),
      )
      .onConflictDoUpdate({
        target: [schema.release.repositoryId, schema.release.tagName],
        set: {
          name: excluded(schema.release.name),
          body: excluded(schema.release.body),
          isDraft: excluded(schema.release.isDraft),
          isPrerelease: excluded(schema.release.isPrerelease),
          createdAt: excluded(schema.release.createdAt),
          publishedAt: excluded(schema.release.publishedAt),
        },
      });
  }

  /** Issues and pull requests share GitHub's number sequence, as they do here, so numbers are kept and `#123` links in imported text still point at the right thing. A re-sent issue loses its comments, which the attempt sends again after it. */
  async writeIssues(repositoryId: string, issues: ImportedIssueDTO[]) {
    if (!issues.length) return;
    await this.db.transaction(async (tx) => {
      const labelIds = await this.upsertLabels(tx, repositoryId, issues);

      for (const issue of issues) {
        const forkPullRequest =
          issue.pullRequest?.state === 'open' &&
          !issue.pullRequest.headInRepository;
        const closedAt = forkPullRequest
          ? new Date(issue.updatedAt)
          : issue.closedAt
            ? new Date(issue.closedAt)
            : null;
        const body = attributed(
          issue.authorLogin,
          'Opened',
          forkPullRequest
            ? `${issue.body ?? ''}\n\n_This pull request came from a fork, so it was closed when the repository was imported._`
            : issue.body,
        );

        const [row] = await tx
          .insert(schema.issue)
          .values({
            repositoryId,
            number: issue.number,
            title: issue.title,
            body,
            state: forkPullRequest ? 'closed' : issue.state,
            isPullRequest: Boolean(issue.pullRequest),
            authorId: IMPORTER,
            commentCount: 0,
            closedAt,
            createdAt: new Date(issue.createdAt),
            updatedAt: new Date(issue.updatedAt),
          })
          .onConflictDoUpdate({
            target: [schema.issue.repositoryId, schema.issue.number],
            set: {
              title: excluded(schema.issue.title),
              body: excluded(schema.issue.body),
              state: excluded(schema.issue.state),
              isPullRequest: excluded(schema.issue.isPullRequest),
              commentCount: 0,
              closedAt: excluded(schema.issue.closedAt),
              createdAt: excluded(schema.issue.createdAt),
              updatedAt: excluded(schema.issue.updatedAt),
            },
          })
          .returning({ id: schema.issue.id });

        await tx
          .delete(schema.issueComment)
          .where(eq(schema.issueComment.issueId, row.id));
        await tx
          .delete(schema.issueLabel)
          .where(eq(schema.issueLabel.issueId, row.id));
        if (issue.labels.length) {
          await tx.insert(schema.issueLabel).values(
            issue.labels.map((label) => ({
              issueId: row.id,
              labelId: labelIds.get(label.name)!,
            })),
          );
        }

        const pull = issue.pullRequest;
        if (!pull) continue;
        const values = {
          state: forkPullRequest ? ('closed' as const) : pull.state,
          draft: pull.draft,
          baseRepositoryId: repositoryId,
          baseRef: pull.baseRef,
          headRepositoryId: pull.headInRepository ? repositoryId : null,
          headRef: pull.headRef,
          headSha: pull.headSha,
          mergeCommitSha: pull.mergeCommitSha,
          mergedAt: pull.mergedAt ? new Date(pull.mergedAt) : null,
        };
        await tx
          .insert(schema.pullRequest)
          .values({ issueId: row.id, ...values })
          .onConflictDoUpdate({
            target: schema.pullRequest.issueId,
            set: values,
          });
      }
    });
  }

  async writeComments(repositoryId: string, comments: ImportedCommentDTO[]) {
    if (!comments.length) return;
    const numbers = [
      ...new Set(comments.map((comment) => comment.issueNumber)),
    ];
    await this.db.transaction(async (tx) => {
      const issues = await tx
        .select({ id: schema.issue.id, number: schema.issue.number })
        .from(schema.issue)
        .where(
          and(
            eq(schema.issue.repositoryId, repositoryId),
            inArray(schema.issue.number, numbers),
          ),
        );
      const idOf = new Map(issues.map((issue) => [issue.number, issue.id]));

      // GitHub lists comments on issues the token could not list itself, such as ones transferred away; those are dropped.
      const rows = comments.flatMap((comment) => {
        const issueId = idOf.get(comment.issueNumber);
        if (!issueId) return [];
        return [
          {
            issueId,
            githubId: comment.githubId,
            authorId: IMPORTER,
            body: attributed(comment.authorLogin, 'Posted', comment.body),
            createdAt: new Date(comment.createdAt),
            updatedAt: new Date(comment.updatedAt),
          },
        ];
      });
      if (!rows.length) return;
      await tx
        .insert(schema.issueComment)
        .values(rows)
        .onConflictDoNothing({
          target: [schema.issueComment.issueId, schema.issueComment.githubId],
        });

      await tx
        .update(schema.issue)
        .set({
          commentCount: sql`(select count(*) from ${schema.issueComment} where ${schema.issueComment.issueId} = ${schema.issue.id})`,
          // Keeps GitHub's timestamp rather than letting `$onUpdateFn` stamp the import time.
          updatedAt: sql`${schema.issue.updatedAt}`,
        })
        .where(inArray(schema.issue.id, [...idOf.values()]));
    });
  }

  private async upsertLabels(
    tx: Executor,
    repositoryId: string,
    issues: ImportedIssueDTO[],
  ) {
    const labels = new Map(
      issues
        .flatMap((issue) => issue.labels)
        .map((label) => [label.name, label]),
    );
    if (!labels.size) return new Map<string, string>();

    await tx
      .insert(schema.label)
      .values(
        [...labels.values()].map((label) => ({
          repositoryId,
          name: label.name,
          color: label.color,
          description: label.description,
        })),
      )
      .onConflictDoNothing({
        target: [schema.label.repositoryId, schema.label.name],
      });

    const rows = await tx
      .select({ id: schema.label.id, name: schema.label.name })
      .from(schema.label)
      .where(
        and(
          eq(schema.label.repositoryId, repositoryId),
          inArray(schema.label.name, [...labels.keys()]),
        ),
      );
    return new Map(rows.map((row) => [row.name, row.id]));
  }
}
