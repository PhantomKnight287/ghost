import { Injectable } from '@nestjs/common';

import { UnprocessableError } from '../../../../lib/github/github.errors.js';
import type { Loaders } from '../../../../lib/github/loaders.js';
import {
  decodeNodeIdAs,
  encodeNodeId,
} from '../../../../lib/github/node-id.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import { PullRequestsService } from '../../../../resources/pull-requests/pull-requests.service.js';
import { ReviewRequestsService } from '../../../../resources/pull-requests/review-requests.service.js';
import { ReviewThreadsService } from '../../../../resources/pull-requests/review-threads.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { requireWriteScope } from '../../../auth/require-scopes.js';
import { PullRequestState, PullRequestUpdateState } from '../../enums.js';
import * as M from '../../types/mutations.type.js';
import { PullRequestNode } from '../../types/pull-request.type.js';
import type { RepositoryNode } from '../../types/repository.type.js';
import { IssueNodesService } from '../issue/issue-nodes.service.js';
import {
  IssueMutationsService,
  type IssueRef,
} from '../issue-mutations/issue-mutations.service.js';
import { PullRequestNodesService } from '../pull-request/pull-request-nodes.service.js';

@Injectable()
export class PullRequestMutationsService {
  constructor(
    private readonly pulls: PullRequestsService,
    private readonly reviewRequests: ReviewRequestsService,
    private readonly issues: IssuesService,
    private readonly mutations: IssueMutationsService,
    private readonly issueNodes: IssueNodesService,
    private readonly threads: ReviewThreadsService,
    private readonly pullNodes: PullRequestNodesService,
  ) {}

  async createPullRequest(
    input: M.CreatePullRequestInput,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    const signedIn = this.mutations.require(viewer, 'CreatePullRequest');
    const repository = await this.mutations.repositoryFor(
      input.repositoryId,
      signedIn,
    );
    requireWriteScope(signedIn, 'createPullRequest', repository);
    const head = await this.headSpec(input, repository, signedIn);
    const created = await this.mutations.write(
      'CreatePullRequest',
      signedIn.userId,
      loaders,
      () =>
        this.pulls.createPullRequest({
          username: repository.ownerLogin,
          repo: repository.slug,
          requesterId: signedIn.userId,
          body: {
            title: input.title,
            body: input.body ?? undefined,
            base: input.baseRefName,
            head,
            draft: input.draft ?? false,
          },
        }),
    );
    return {
      clientMutationId: input.clientMutationId,
      pullRequest: await this.node(repository, created.number, signedIn),
    };
  }

  async updatePullRequest(
    input: M.UpdatePullRequestInput,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    const signedIn = this.mutations.require(viewer, 'UpdatePullRequest');
    this.mutations.refuseMilestonesAndProjects(input);
    const { repository, ref } = await this.mutations.issueRef(
      input.pullRequestId,
      signedIn,
      ['PullRequest'],
    );
    requireWriteScope(signedIn, 'updatePullRequest', repository);
    const current = await this.node(repository, ref.number, signedIn);
    if (input.baseRefName != null && input.baseRefName !== current.baseRefName)
      throw new UnprocessableError(
        'Ghost cannot change the base branch of a pull request',
      );
    if (
      input.state === PullRequestUpdateState.OPEN &&
      current.state === PullRequestState.MERGED
    )
      throw new UnprocessableError('A merged pull request cannot be reopened');
    const labels = input.labelIds
      ? await this.mutations.labelNames(repository, input.labelIds)
      : null;
    const assignees = input.assigneeIds
      ? await this.mutations.usernames(input.assigneeIds)
      : null;
    // ponytail: one transaction per changed aspect, as updateIssue does.
    await this.mutations.write(
      'UpdatePullRequest',
      signedIn.userId,
      loaders,
      async () => {
        if (input.title != null || input.body !== undefined)
          await this.pulls.updatePullRequest({
            ...ref,
            body: { title: input.title ?? undefined, body: input.body },
          });
        // Setting the state a request already has is a no-op on GitHub; Ghost refuses it.
        if (
          input.state === PullRequestUpdateState.CLOSED &&
          current.state === PullRequestState.OPEN
        )
          await this.pulls.closePullRequest(ref);
        if (
          input.state === PullRequestUpdateState.OPEN &&
          current.state === PullRequestState.CLOSED
        )
          await this.pulls.reopenPullRequest(ref);
        if (labels) await this.issues.setIssueLabels({ ...ref, names: labels });
        if (assignees)
          await this.issues.setIssueAssignees({ ...ref, usernames: assignees });
      },
    );
    return {
      clientMutationId: input.clientMutationId,
      pullRequest: await this.node(repository, ref.number, signedIn),
    };
  }

  closePullRequest(
    input: M.ClosePullRequestInput,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    return this.change('ClosePullRequest', input, viewer, loaders, (ref) =>
      this.pulls.closePullRequest(ref),
    );
  }

  reopenPullRequest(
    input: M.ReopenPullRequestInput,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    return this.change('ReopenPullRequest', input, viewer, loaders, (ref) =>
      this.pulls.reopenPullRequest(ref),
    );
  }

  markPullRequestReadyForReview(
    input: M.MarkPullRequestReadyForReviewInput,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    return this.change(
      'MarkPullRequestReadyForReview',
      input,
      viewer,
      loaders,
      (ref) => this.pulls.setDraft({ ...ref, draft: false }),
    );
  }

  convertPullRequestToDraft(
    input: M.ConvertPullRequestToDraftInput,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    return this.change(
      'ConvertPullRequestToDraft',
      input,
      viewer,
      loaders,
      (ref) => this.pulls.setDraft({ ...ref, draft: true }),
    );
  }

  mergePullRequest(
    input: M.MergePullRequestInput,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    return this.change(
      'MergePullRequest',
      input,
      viewer,
      loaders,
      async (ref) => {
        if (input.expectedHeadOid) {
          // ponytail: checked before the merge, not under its lock; a push landing in between merges the newer head.
          const { headSha } = await this.pulls.getPullRequest(ref);
          if (headSha !== input.expectedHeadOid)
            throw new UnprocessableError(
              'Head branch was modified. Review and try the merge again.',
            );
        }
        await this.pulls.mergePullRequest({
          ...ref,
          method: input.mergeMethod
            ? (input.mergeMethod.toLowerCase() as Lowercase<
                typeof input.mergeMethod
              >)
            : undefined,
          title: input.commitHeadline || undefined,
          message: input.commitBody ?? undefined,
          compat: true,
        });
      },
    );
  }

  requestReviews(
    input: M.RequestReviewsInput,
    viewer: GithubViewer | null,
    loaders: Loaders,
  ) {
    return this.change(
      'RequestReviews',
      input,
      viewer,
      loaders,
      async (ref, repository) => {
        const users = await this.mutations.usernames(input.userIds ?? []);
        const teams = await this.mutations.teamSlugs(
          repository,
          input.teamIds ?? [],
        );
        const pending = await this.reviewRequests.request({
          ...ref,
          users,
          teams,
        });
        if (input.union) return;
        await this.reviewRequests.remove({
          ...ref,
          users: pending.users
            .map((user) => user.username)
            .filter((username) => !users.includes(username)),
          teams: pending.teams
            .map((team) => team.slug)
            .filter((slug) => !teams.includes(slug)),
        });
      },
    );
  }

  /** Resolves or reopens the thread `threadId` names, and answers with it as it then stands. */
  async resolveReviewThread(
    input: M.ResolveReviewThreadInput,
    viewer: GithubViewer | null,
    loaders: Loaders,
    resolved: boolean,
  ) {
    const mutation = resolved ? 'ResolveReviewThread' : 'UnresolveReviewThread';
    const signedIn = this.mutations.require(viewer, mutation);
    const [issueId, commentId] = decodeNodeIdAs(
      input.threadId,
      'PullRequestReviewThread',
    ).split(':');
    if (!issueId || !commentId) throw this.mutations.unresolved(input.threadId);
    const { repository, ref } = await this.mutations.issueRef(
      encodeNodeId('PullRequest', issueId),
      signedIn,
      ['PullRequest'],
    );
    requireWriteScope(
      signedIn,
      mutation[0]!.toLowerCase() + mutation.slice(1),
      repository,
    );
    await this.mutations.write(mutation, signedIn.userId, loaders, () =>
      this.threads.resolve({ ...ref, commentId, resolved }),
    );
    const [thread] = await this.pullNodes.reviewThreads(
      await this.node(repository, ref.number, signedIn),
      signedIn,
      loaders,
      commentId,
    );
    return { clientMutationId: input.clientMutationId, thread };
  }

  /** A mutation that names one pull request, runs `run` on it, and answers with it as it then stands. */
  private async change(
    mutation: string,
    input: { pullRequestId: string; clientMutationId?: string | null },
    viewer: GithubViewer | null,
    loaders: Loaders,
    run: (ref: IssueRef, repository: RepositoryNode) => Promise<unknown>,
  ) {
    const signedIn = this.mutations.require(viewer, mutation);
    const { repository, ref } = await this.mutations.issueRef(
      input.pullRequestId,
      signedIn,
      ['PullRequest'],
    );
    const field = mutation[0]!.toLowerCase() + mutation.slice(1);
    requireWriteScope(signedIn, field, repository);
    await this.mutations.write(mutation, signedIn.userId, loaders, () =>
      run(ref, repository),
    );
    return {
      clientMutationId: input.clientMutationId,
      pullRequest: await this.node(repository, ref.number, signedIn),
    };
  }

  private async node(
    repository: RepositoryNode,
    number: number,
    viewer: GithubViewer,
  ) {
    const found = await this.issueNodes.fromRepository(
      repository,
      number,
      viewer,
    );
    if (!(found instanceof PullRequestNode))
      throw this.mutations.unresolved(found.id);
    return found;
  }

  /** Ghost's `owner:branch`: gh writes it itself for a fork, or names the fork by `headRepositoryId`. */
  private async headSpec(
    input: M.CreatePullRequestInput,
    repository: RepositoryNode,
    viewer: GithubViewer,
  ) {
    if (input.headRefName.includes(':') || !input.headRepositoryId)
      return input.headRefName;
    const head = await this.mutations.repositoryFor(
      input.headRepositoryId,
      viewer,
    );
    return head.ghostId === repository.ghostId
      ? input.headRefName
      : `${head.ownerLogin}:${input.headRefName}`;
  }
}
