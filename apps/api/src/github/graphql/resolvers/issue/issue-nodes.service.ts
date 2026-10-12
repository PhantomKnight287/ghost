import type { Database } from '@ghost/db';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DATABASE } from '../../../../database/database.module.js';
import { CouldNotResolveError } from '../../../../lib/github/github.errors.js';
import type { Loaders } from '../../../../lib/github/loaders.js';
import { pullRequestRowsOf } from '../../../../lib/github/node-lookup.js';
import {
  toIssueCommentNode,
  toIssueNode,
  toLabelNode,
  toPullRequestNode,
  toUserNode,
  type UserRow,
} from '../../../../lib/github/nodes.js';
import { githubOrigins } from '../../../../lib/github/origins.js';
import { IssueNotFoundError } from '../../../../lib/issues/issues.errors.js';
import type { IssueDTO } from '../../../../resources/issues/dto/issue.dto.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { sliceConnection } from '../../connection.js';
import type { IssueOrPullRequestFields } from '../../types/issue-or-pull-request.type.js';
import { RepositoryNode } from '../../types/repository.type.js';

@Injectable()
export class IssueNodesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly issues: IssuesService,
    private readonly config: ConfigService,
  ) {}

  /** The issue or pull request behind a number, for repository.issue, issueOrPullRequest, node(id:) and the mutations. */
  async fromRepository(
    repository: RepositoryNode,
    number: number,
    viewer: GithubViewer | null,
  ) {
    try {
      const issue = await this.issues.getIssue({
        username: repository.ownerLogin,
        repo: repository.slug,
        number,
        requesterId: viewer?.userId,
      });
      const [node] = await this.toNodes([issue], repository);
      return node!;
    } catch (error) {
      if (error instanceof IssueNotFoundError)
        throw new CouldNotResolveError(
          `Could not resolve to an issue or pull request with the number of ${number}.`,
        );
      throw error;
    }
  }

  /** Issue or pull request nodes in the order given; the pull_request rows behind them are read in one query. */
  async toNodes(issues: IssueDTO[], repository: RepositoryNode) {
    const pulls = await pullRequestRowsOf(
      this.db,
      issues.filter((issue) => issue.isPullRequest).map((issue) => issue.id),
    );
    return issues.map((issue) => {
      const pull = pulls.get(issue.id);
      return pull
        ? toPullRequestNode(issue, repository, pull)
        : toIssueNode(issue, repository);
    });
  }

  /** The author of an issue, pull request, comment or review. */
  async author({ authorLogin }: { authorLogin: string }, loaders: Loaders) {
    const row = await loaders.usersByLogin.load(authorLogin);
    return row ? toUserNode(row, githubOrigins(this.config)) : null;
  }

  async assignees(
    issue: IssueOrPullRequestFields,
    loaders: Loaders,
    first?: number,
  ) {
    const rows = (
      await loaders.usersByLogin.loadMany(issue.assigneeLogins)
    ).filter((row): row is UserRow => !!row && !(row instanceof Error));
    return sliceConnection(
      rows.map((row) => toUserNode(row, githubOrigins(this.config))),
      { first },
    );
  }

  labels(issue: IssueOrPullRequestFields, first?: number) {
    const repository = {
      url: issue.repositoryUrl,
      resourcePath: issue.repositoryResourcePath,
    };
    return sliceConnection(
      issue.labelDtos.map((label) => toLabelNode(label, repository)),
      { first },
    );
  }

  async comments(
    issue: IssueOrPullRequestFields,
    viewer: GithubViewer | null,
    loaders: Loaders,
    first?: number,
    last?: number,
    after?: string,
  ) {
    const { comments } = await this.issues.getComments({
      username: issue.ownerLogin,
      repo: issue.repoSlug,
      number: issue.number,
      requesterId: viewer?.userId,
    });
    const viewerLogin = viewer
      ? ((await loaders.usersById.load(viewer.userId))?.username ?? null)
      : null;
    return sliceConnection(
      comments.map((comment) =>
        toIssueCommentNode(comment, issue, viewerLogin),
      ),
      { first, last, after },
    );
  }

  /** IssueDTO leaves the numeric id out, as Ghost's own API does not return it. */
  databaseId(issue: IssueOrPullRequestFields, loaders: Loaders) {
    return loaders.issueNumericIds.load(issue.ghostId);
  }
}
