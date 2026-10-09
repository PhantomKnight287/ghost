import { Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

import { URI } from '../scalars.js';
import { Actor, Node, RepositoryOwner, UniformResourceLocatable } from './node.interface.js';

@ObjectType('User', { implements: () => [Node, Actor, RepositoryOwner, UniformResourceLocatable] })
export class UserNode {
  kind = 'User';
  /** Ghost id, for resolvers; not a GraphQL field. */
  ghostId: string;

  @Field(() => ID)
  id: string;

  @Field()
  login: string;

  @Field(() => String, { nullable: true })
  name: string | null;

  @Field(() => URI)
  avatarUrl: string;

  @Field(() => URI)
  resourcePath: string;

  @Field(() => URI)
  url: string;

  @Field(() => Int, { nullable: true })
  databaseId: number | null;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;
}
