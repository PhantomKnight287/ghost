import { ConfigService } from '@nestjs/config';
import { Context, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { AllowAnonymous } from '@thallesp/nestjs-better-auth';

import type { GraphqlContext } from '../../../../lib/github/loaders.js';
import { toUserNode } from '../../../../lib/github/nodes.js';
import { githubOrigins } from '../../../../lib/github/origins.js';
import { IssueCommentNode } from '../../types/issue-comment.type.js';
import { Actor } from '../../types/node.interface.js';
import { ReactionGroup } from '../../types/placeholders.type.js';

@Resolver(() => IssueCommentNode)
@AllowAnonymous()
export class IssueCommentResolver {
  constructor(private readonly config: ConfigService) {}

  @ResolveField(() => Actor, { nullable: true })
  async author(
    @Parent() comment: IssueCommentNode,
    @Context() { loaders }: GraphqlContext,
  ) {
    const row = await loaders.usersByLogin.load(comment.authorLogin);
    return row ? toUserNode(row, githubOrigins(this.config)) : null;
  }

  @ResolveField(() => [ReactionGroup], { nullable: true })
  reactionGroups() {
    return [];
  }
}
