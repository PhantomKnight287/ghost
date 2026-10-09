import { Field, GraphQLISODateTime, ID, Int, ObjectType } from '@nestjs/graphql';

import type { LabelDTO } from '../../../resources/issues/dto/label.dto.js';
import { HTML, URI } from '../scalars.js';

/** What GitHub's Issue and PullRequest share and gh asks of both: gh's issue lookup selects one field list on both fragments. */
@ObjectType({ isAbstract: true })
export abstract class IssueOrPullRequestFields {
  abstract kind: 'Issue' | 'PullRequest';
  ghostId: string;
  ownerLogin: string;
  repoSlug: string;
  repositoryGhostId: string;
  authorLogin: string;
  assigneeLogins: string[];
  labelDtos: LabelDTO[];
  repositoryUrl: string;
  repositoryResourcePath: string;

  @Field(() => ID)
  id: string;

  @Field(() => Int, { nullable: true })
  databaseId: number | null;

  @Field(() => Int)
  number: number;

  @Field()
  title: string;

  @Field()
  body: string;

  @Field(() => HTML)
  bodyHTML: string;

  @Field()
  bodyText: string;

  @Field()
  closed: boolean;

  @Field(() => GraphQLISODateTime, { nullable: true })
  closedAt: Date | null;

  @Field(() => GraphQLISODateTime)
  createdAt: Date;

  @Field(() => GraphQLISODateTime)
  updatedAt: Date;

  @Field()
  locked: boolean;

  @Field()
  includesCreatedEdit: boolean;

  @Field()
  viewerCanUpdate: boolean;

  @Field(() => URI)
  url: string;

  @Field(() => URI)
  resourcePath: string;
}
