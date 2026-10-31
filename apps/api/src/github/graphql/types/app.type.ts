import {
  createUnionType,
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';

import { URI } from '../scalars.js';
import { Node } from './node.interface.js';
import { TeamNode } from './placeholders.type.js';

@ObjectType('App', { implements: () => [Node] })
export class AppNode {
  kind = 'App';

  @Field(() => ID)
  id: string;

  @Field(() => Int, { nullable: true })
  databaseId: number;

  @Field()
  name: string;

  @Field()
  slug: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field(() => String, { nullable: true })
  clientId: string | null;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  logoUrl: string;

  @Field()
  logoBackgroundColor: string;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt: Date;
}

export const BypassActor = createUnionType({
  name: 'BypassActor',
  types: () => [AppNode, TeamNode] as const,
  resolveType: (value: { kind: string }) => value.kind,
});
