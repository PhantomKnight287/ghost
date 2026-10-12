import { Args, Context, Mutation, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import type { GithubViewer } from '../../../auth/github-request.js';
import { Viewer } from '../../../auth/viewer.decorator.js';
import * as M from '../../types/mutations.type.js';
import { IssueMutationsService } from './issue-mutations.service.js';

@Resolver()
@AllowAnonymous()
export class IssueMutationsResolver {
  constructor(private readonly mutations: IssueMutationsService) {}

  @Mutation(() => M.CreateIssuePayload, { nullable: true })
  createIssue(
    @Args('input') input: M.CreateIssueInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.createIssue(input, viewer, context.loaders);
  }

  @Mutation(() => M.UpdateIssuePayload, { nullable: true })
  updateIssue(
    @Args('input') input: M.UpdateIssueInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.updateIssue(input, viewer, context.loaders);
  }

  @Mutation(() => M.CloseIssuePayload, { nullable: true })
  closeIssue(
    @Args('input') input: M.CloseIssueInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.closeIssue(input, viewer, context.loaders);
  }

  @Mutation(() => M.ReopenIssuePayload, { nullable: true })
  reopenIssue(
    @Args('input') input: M.ReopenIssueInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.reopenIssue(input, viewer, context.loaders);
  }

  @Mutation(() => M.AddCommentPayload, { nullable: true })
  addComment(
    @Args('input') input: M.AddCommentInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.addComment(input, viewer, context.loaders);
  }

  @Mutation(() => M.AddLabelsToLabelablePayload, { nullable: true })
  addLabelsToLabelable(
    @Args('input') input: M.AddLabelsToLabelableInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.addLabelsToLabelable(input, viewer, context.loaders);
  }

  @Mutation(() => M.RemoveLabelsFromLabelablePayload, { nullable: true })
  removeLabelsFromLabelable(
    @Args('input') input: M.RemoveLabelsFromLabelableInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.removeLabelsFromLabelable(
      input,
      viewer,
      context.loaders,
    );
  }

  @Mutation(() => M.AddAssigneesToAssignablePayload, { nullable: true })
  addAssigneesToAssignable(
    @Args('input') input: M.AddAssigneesToAssignableInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.addAssigneesToAssignable(
      input,
      viewer,
      context.loaders,
    );
  }

  @Mutation(() => M.RemoveAssigneesFromAssignablePayload, { nullable: true })
  removeAssigneesFromAssignable(
    @Args('input') input: M.RemoveAssigneesFromAssignableInput,
    @Viewer() viewer: GithubViewer | null,
    @Context() context: GraphqlContext,
  ) {
    return this.mutations.removeAssigneesFromAssignable(
      input,
      viewer,
      context.loaders,
    );
  }
}
