import { Field, GraphQLISODateTime, ID, ObjectType } from '@nestjs/graphql';

import { Connection } from '../connection.js';
import { CommentAuthorAssociation } from '../enums.js';
import { URI } from '../scalars.js';
import { Node } from './node.interface.js';

@ObjectType('IssueComment', { implements: () => [Node] })
export class IssueCommentNode {
  kind = 'IssueComment';
  ghostId: string;
  authorLogin: string;

  @Field(() => ID)
  id: string;

  @Field()
  body: string;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt: Date;

  @Field()
  includesCreatedEdit: boolean;

  @Field()
  isMinimized: boolean;

  @Field(() => String, { nullable: true })
  minimizedReason: string | null;

  @Field(() => CommentAuthorAssociation)
  authorAssociation: CommentAuthorAssociation;

  @Field()
  viewerDidAuthor: boolean;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;
}

export const IssueCommentConnection = Connection(
  IssueCommentNode,
  'IssueComment',
);
