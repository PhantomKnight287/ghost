import {
  Field,
  GraphQLISODateTime,
  ID,
  Int,
  ObjectType,
} from '@nestjs/graphql';

import { Connection } from '../connection.js';
import { URI } from '../scalars.js';
import { Node, UniformResourceLocatable } from './node.interface.js';

@ObjectType('Release', { implements: () => [Node, UniformResourceLocatable] })
export class ReleaseNode {
  kind = 'Release';

  @Field(() => ID)
  id: string;

  @Field(() => Int, { nullable: true })
  databaseId: number | null;

  @Field(() => String, { nullable: true })
  name: string | null;

  @Field()
  tagName: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field()
  isDraft: boolean;

  @Field()
  isLatest: boolean;

  @Field()
  isPrerelease: boolean;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field(() => GraphQLISODateTime, { nullable: true })
  publishedAt: Date | null;

  @Field(() => GraphQLISODateTime)
  updatedAt: Date;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;
}

export const ReleaseConnection = Connection(ReleaseNode, 'Release');
