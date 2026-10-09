import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

import { Connection } from '../connection.js';
import { URI } from '../scalars.js';
import { Node } from './node.interface.js';

@ObjectType('Label', { implements: () => [Node] })
export class LabelNode {
  kind = 'Label';
  ghostId: string;

  @Field(() => ID)
  id: string;

  @Field()
  name: string;

  @Field()
  color: string;

  @Field(() => String, { nullable: true })
  description: string | null;

  @Field()
  isDefault: boolean;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;

  @Field(() => GraphQLISODateTime, { nullable: true })
  createdAt: string | null;

  @Field(() => GraphQLISODateTime, { nullable: true })
  updatedAt: string | null;
}

export const LabelConnection = Connection(LabelNode, 'Label');
