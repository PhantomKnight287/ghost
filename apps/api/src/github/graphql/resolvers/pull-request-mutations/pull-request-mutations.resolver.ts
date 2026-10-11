import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import { UnprocessableError } from '../../../../lib/github/github.errors.js';
import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { IssuesService } from '../../../../resources/issues/issues.service.js';
import { PullRequestsService } from '../../../../resources/pull-requests/pull-requests.service.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { requireWriteScope } from '../../../auth/require-scopes.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import { PullRequestState, PullRequestUpdateState } from '../../enums.js';
import * as M from '../../types/mutations.type.js';
import { PullRequestNode } from '../../types/pull-request.type.js';
import type { RepositoryNode } from '../../types/repository.type.js';
import { IssueResolver } from '../issue/issue.resolver.js';
import {
  type IssueRef,
  IssueMutationsResolver,
} from '../issue-mutations/issue-mutations.resolver.js';

/** GitHub's pull request mutations over PullRequestsService; labels, assignees and comments go through IssueMutationsResolver, which takes `PR_` ids too. */
@Resolver()
@AllowAnonymous()
export class PullRequestMutationsResolver {
  constructor(
    private readonly pulls: PullRequestsService,
    private readonly issues: IssuesService,
    private readonly mutations: IssueMutationsResolver,
    private readonly issueNodes: IssueResolver,
  ) {}

  @Mutation(() => M.CreatePullRequestPayload, { nullable: true })
  async createPullRequest(
    @Args('input') input: M.CreatePullRequestInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
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
      context,
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

  @Mutation(() => M.UpdatePullRequestPayload, { nullable: true })
  async updatePullRequest(
    @Args('input') input: M.UpdatePullRequestInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    const signedIn = this.mutations.require(viewer, 'UpdatePullRequest');
    this.mutations.refuseMilestonesAndProjects(input);
    const { repository, ref } = await this.ref(input.pullRequestId, signedIn);
    requireWriteScope(signedIn, 'updatePullRequest', repository);
    const current = await this.node(repository, ref.number, signedIn);
    if (input.baseRefName != null && input.baseRefName !== current.baseRefName)
      throw new UnprocessableError(
        'Ghost cannot change the base branch of a pull request',
      );
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
      context,
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

  @Mutation(() => M.ClosePullRequestPayload, { nullable: true })
  closePullRequest(
    @Args('input') input: M.ClosePullRequestInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.change('ClosePullRequest', input, viewer, context, (ref) =>
      this.pulls.closePullRequest(ref),
    );
  }

  @Mutation(() => M.ReopenPullRequestPayload, { nullable: true })
  reopenPullRequest(
    @Args('input') input: M.ReopenPullRequestInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.change('ReopenPullRequest', input, viewer, context, (ref) =>
      this.pulls.reopenPullRequest(ref),
    );
  }

  @Mutation(() => M.MarkPullRequestReadyForReviewPayload, { nullable: true })
  markPullRequestReadyForReview(
    @Args('input') input: M.MarkPullRequestReadyForReviewInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.change(
      'MarkPullRequestReadyForReview',
      input,
      viewer,
      context,
      (ref) => this.pulls.setDraft({ ...ref, draft: false }),
    );
  }

  @Mutation(() => M.ConvertPullRequestToDraftPayload, { nullable: true })
  convertPullRequestToDraft(
    @Args('input') input: M.ConvertPullRequestToDraftInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.change(
      'ConvertPullRequestToDraft',
      input,
      viewer,
      context,
      (ref) => this.pulls.setDraft({ ...ref, draft: true }),
    );
  }

  @Mutation(() => M.MergePullRequestPayload, { nullable: true })
  mergePullRequest(
    @Args('input') input: M.MergePullRequestInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.change(
      'MergePullRequest',
      input,
      viewer,
      context,
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
        });
      },
    );
  }

  /** A mutation that names one pull request, runs `run` on it, and answers with it as it then stands. */
  private async change(
    mutation: string,
    input: { pullRequestId: string; clientMutationId?: string | null },
    viewer: GithubViewer | null,
    context: GraphqlContext,
    run: (ref: IssueRef) => Promise<unknown>,
  ) {
    const signedIn = this.mutations.require(viewer, mutation);
    const { repository, ref } = await this.ref(input.pullRequestId, signedIn);
    const field = mutation[0]!.toLowerCase() + mutation.slice(1);
    requireWriteScope(signedIn, field, repository);
    await this.mutations.write(mutation, signedIn.userId, context, () =>
      run(ref),
    );
    return {
      clientMutationId: input.clientMutationId,
      pullRequest: await this.node(repository, ref.number, signedIn),
    };
  }

  private ref(nodeId: string, viewer: GithubViewer) {
    return this.mutations.issueRef(nodeId, viewer, ['PullRequest']);
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
