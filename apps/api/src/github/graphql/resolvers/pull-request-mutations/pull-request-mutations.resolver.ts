import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import * as M from '../../types/mutations.type.js';
import { PullRequestMutationsService } from './pull-request-mutations.service.js';

/** GitHub's pull request mutations over PullRequestsService; labels, assignees and comments go through IssueMutationsService, which takes `PR_` ids too. */
@Resolver()
@AllowAnonymous()
export class PullRequestMutationsResolver {
  constructor(private readonly mutations: PullRequestMutationsService) {}

  @Mutation(() => M.CreatePullRequestPayload, { nullable: true })
  createPullRequest(
    @Args('input') input: M.CreatePullRequestInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.createPullRequest(input, viewer, context.loaders);
  }

  @Mutation(() => M.UpdatePullRequestPayload, { nullable: true })
  updatePullRequest(
    @Args('input') input: M.UpdatePullRequestInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.updatePullRequest(input, viewer, context.loaders);
  }

  @Mutation(() => M.ClosePullRequestPayload, { nullable: true })
  closePullRequest(
    @Args('input') input: M.ClosePullRequestInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.closePullRequest(input, viewer, context.loaders);
  }

  @Mutation(() => M.ReopenPullRequestPayload, { nullable: true })
  reopenPullRequest(
    @Args('input') input: M.ReopenPullRequestInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.reopenPullRequest(input, viewer, context.loaders);
  }

  @Mutation(() => M.MarkPullRequestReadyForReviewPayload, { nullable: true })
  markPullRequestReadyForReview(
    @Args('input') input: M.MarkPullRequestReadyForReviewInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.markPullRequestReadyForReview(
      input,
      viewer,
      context.loaders,
    );
  }

  @Mutation(() => M.ConvertPullRequestToDraftPayload, { nullable: true })
  convertPullRequestToDraft(
    @Args('input') input: M.ConvertPullRequestToDraftInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.convertPullRequestToDraft(
      input,
      viewer,
      context.loaders,
    );
  }

  @Mutation(() => M.RequestReviewsPayload, { nullable: true })
  requestReviews(
    @Args('input') input: M.RequestReviewsInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.requestReviews(input, viewer, context.loaders);
  }

  @Mutation(() => M.ResolveReviewThreadPayload, { nullable: true })
  resolveReviewThread(
    @Args('input') input: M.ResolveReviewThreadInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.resolveReviewThread(
      input,
      viewer,
      context.loaders,
      true,
    );
  }

  @Mutation(() => M.UnresolveReviewThreadPayload, { nullable: true })
  unresolveReviewThread(
    @Args('input') input: M.UnresolveReviewThreadInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.resolveReviewThread(
      input,
      viewer,
      context.loaders,
      false,
    );
  }

  @Mutation(() => M.MergePullRequestPayload, { nullable: true })
  mergePullRequest(
    @Args('input') input: M.MergePullRequestInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.mergePullRequest(input, viewer, context.loaders);
  }
}
