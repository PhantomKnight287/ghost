import { Context, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { IssueCommentNode } from '../../types/issue-comment.type.js';
import { Actor } from '../../types/node.interface.js';
import { ReactionGroup } from '../../types/placeholders.type.js';
import { IssueNodesService } from '../issue/issue-nodes.service.js';

@Resolver(() => IssueCommentNode)
@AllowAnonymous()
export class IssueCommentResolver {
  constructor(private readonly issues: IssueNodesService) {}

  @ResolveField(() => Actor, { nullable: true })
  author(
    @Parent() comment: IssueCommentNode,
    @Context() { loaders }: GraphqlContext,
  ) {
    return this.issues.author(comment, loaders);
  }

  @ResolveField(() => [ReactionGroup], { nullable: true })
  reactionGroups() {
    return [];
  }
}
