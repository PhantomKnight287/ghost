import { Field, ID, InputType, ObjectType } from '@nestjs/graphql';
import { Allow } from 'class-validator';

import {
  IssueClosedStateReason,
  IssueState,
  PullRequestMergeMethod,
  PullRequestUpdateState,
  RepositoryVisibility,
} from '../enums.js';
import { GitObjectID, URI } from '../scalars.js';
import { IssueCommentNode } from './issue-comment.type.js';
import { IssueNode } from './issue.type.js';
import { Assignable, Labelable } from './node.interface.js';
import {
  PullRequestNode,
  PullRequestReviewThreadNode,
} from './pull-request.type.js';
import { RepositoryNode } from './repository.type.js';

// GraphQL already checks every input's types and nullability; @Allow only keeps fields through the global ValidationPipe's whitelist.
@InputType('CreateIssueInput')
export class CreateIssueInput {
  @Allow()
  @Field(() => ID)
  repositoryId: string;

  @Allow()
  @Field()
  title: string;

  @Allow()
  @Field(() => String, { nullable: true })
  body?: string | null;

  @Allow()
  @Field(() => [ID], { nullable: true })
  labelIds?: string[] | null;

  @Allow()
  @Field(() => [ID], { nullable: true })
  assigneeIds?: string[] | null;

  // Ghost has no milestones or projects: null is accepted, any id answers NOT_FOUND.
  @Allow()
  @Field(() => ID, { nullable: true })
  milestoneId?: string | null;

  @Allow()
  @Field(() => [ID], { nullable: true })
  projectIds?: string[] | null;

  // Accepted and ignored: Ghost has no issue templates.
  @Allow()
  @Field(() => String, { nullable: true })
  issueTemplate?: string | null;

  @Allow()
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;
}

@InputType('UpdateIssueInput')
export class UpdateIssueInput {
  @Allow()
  @Field(() => ID)
  id: string;

  @Allow()
  @Field(() => String, { nullable: true })
  title?: string | null;

  @Allow()
  @Field(() => String, { nullable: true })
  body?: string | null;

  @Allow()
  @Field(() => IssueState, { nullable: true })
  state?: IssueState | null;

  @Allow()
  @Field(() => [ID], { nullable: true })
  labelIds?: string[] | null;

  @Allow()
  @Field(() => [ID], { nullable: true })
  assigneeIds?: string[] | null;

  // Ghost has no milestones or projects: null is accepted, any id answers NOT_FOUND.
  @Allow()
  @Field(() => ID, { nullable: true })
  milestoneId?: string | null;

  @Allow()
  @Field(() => [ID], { nullable: true })
  projectIds?: string[] | null;

  @Allow()
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;
}

@InputType('CloseIssueInput')
export class CloseIssueInput {
  @Allow()
  @Field(() => ID)
  issueId: string;

  // Accepted for gh's sake; Ghost records no close reason.
  @Allow()
  @Field(() => IssueClosedStateReason, { nullable: true })
  stateReason?: IssueClosedStateReason | null;

  @Allow()
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;
}

@InputType('ReopenIssueInput')
export class ReopenIssueInput {
  @Allow()
  @Field(() => ID)
  issueId: string;

  @Allow()
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;
}

@InputType('AddCommentInput')
export class AddCommentInput {
  @Allow()
  @Field(() => ID)
  subjectId: string;

  @Allow()
  @Field()
  body: string;

  @Allow()
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;
}

@InputType('AddLabelsToLabelableInput')
export class AddLabelsToLabelableInput {
  @Allow()
  @Field(() => ID)
  labelableId: string;

  @Allow()
  @Field(() => [ID])
  labelIds: string[];

  @Allow()
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;
}

@InputType('RemoveLabelsFromLabelableInput')
export class RemoveLabelsFromLabelableInput extends AddLabelsToLabelableInput {}

@InputType('AddAssigneesToAssignableInput')
export class AddAssigneesToAssignableInput {
  @Allow()
  @Field(() => ID)
  assignableId: string;

  @Allow()
  @Field(() => [ID])
  assigneeIds: string[];

  @Allow()
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;
}

@InputType('RemoveAssigneesFromAssignableInput')
export class RemoveAssigneesFromAssignableInput extends AddAssigneesToAssignableInput {}

@ObjectType('IssueCommentEdge')
export class IssueCommentEdge {
  @Field()
  cursor: string;

  @Field(() => IssueCommentNode, { nullable: true })
  node: IssueCommentNode | null;
}

@ObjectType({ isAbstract: true })
abstract class IssuePayload {
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;

  @Field(() => IssueNode, { nullable: true })
  issue: IssueNode | null;
}

@ObjectType('CreateIssuePayload')
export class CreateIssuePayload extends IssuePayload {}

@ObjectType('UpdateIssuePayload')
export class UpdateIssuePayload extends IssuePayload {}

@ObjectType('CloseIssuePayload')
export class CloseIssuePayload extends IssuePayload {}

@ObjectType('ReopenIssuePayload')
export class ReopenIssuePayload extends IssuePayload {}

@ObjectType('AddCommentPayload')
export class AddCommentPayload {
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;

  @Field(() => IssueCommentEdge, { nullable: true })
  commentEdge: IssueCommentEdge | null;
}

@ObjectType({ isAbstract: true })
abstract class LabelablePayload {
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;

  @Field(() => Labelable, { nullable: true })
  labelable: IssueNode | null;
}

@ObjectType('AddLabelsToLabelablePayload')
export class AddLabelsToLabelablePayload extends LabelablePayload {}

@ObjectType('RemoveLabelsFromLabelablePayload')
export class RemoveLabelsFromLabelablePayload extends LabelablePayload {}

@ObjectType({ isAbstract: true })
abstract class AssignablePayload {
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;

  @Field(() => Assignable, { nullable: true })
  assignable: IssueNode | null;
}

@ObjectType('AddAssigneesToAssignablePayload')
export class AddAssigneesToAssignablePayload extends AssignablePayload {}

@ObjectType('RemoveAssigneesFromAssignablePayload')
export class RemoveAssigneesFromAssignablePayload extends AssignablePayload {}

@InputType('CreateRepositoryInput')
export class CreateRepositoryInput {
  @Allow()
  @Field()
  name: string;

  @Allow()
  @Field(() => ID, { nullable: true })
  ownerId?: string | null;

  @Allow()
  @Field(() => String, { nullable: true })
  description?: string | null;

  @Allow()
  @Field(() => RepositoryVisibility)
  visibility: RepositoryVisibility;

  // Accepted and ignored: Ghost has no templates, homepages, wikis or per-repository issue switch, and gives no team access at creation.
  @Allow()
  @Field(() => Boolean, { nullable: true, defaultValue: false })
  template?: boolean | null;

  @Allow()
  @Field(() => URI, { nullable: true })
  homepageUrl?: string | null;

  @Allow()
  @Field(() => Boolean, { nullable: true, defaultValue: false })
  hasWikiEnabled?: boolean | null;

  @Allow()
  @Field(() => Boolean, { nullable: true, defaultValue: true })
  hasIssuesEnabled?: boolean | null;

  @Allow()
  @Field(() => ID, { nullable: true })
  teamId?: string | null;

  @Allow()
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;
}

@ObjectType('CreateRepositoryPayload')
export class CreateRepositoryPayload {
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;

  @Field(() => RepositoryNode, { nullable: true })
  repository: RepositoryNode | null;
}

@InputType('CreatePullRequestInput')
export class CreatePullRequestInput {
  @Allow()
  @Field(() => ID)
  repositoryId: string;

  @Allow()
  @Field()
  baseRefName: string;

  /** A branch of `headRepositoryId`, or `owner:branch` as gh writes it for a fork. */
  @Allow()
  @Field()
  headRefName: string;

  @Allow()
  @Field(() => ID, { nullable: true })
  headRepositoryId?: string | null;

  @Allow()
  @Field()
  title: string;

  @Allow()
  @Field(() => String, { nullable: true })
  body?: string | null;

  @Allow()
  @Field(() => Boolean, { nullable: true })
  draft?: boolean | null;

  // Accepted and ignored: a fork's branch is never writable from the base in Ghost.
  @Allow()
  @Field(() => Boolean, { nullable: true })
  maintainerCanModify?: boolean | null;

  @Allow()
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;
}

@InputType('UpdatePullRequestInput')
export class UpdatePullRequestInput {
  @Allow()
  @Field(() => ID)
  pullRequestId: string;

  @Allow()
  @Field(() => String, { nullable: true })
  title?: string | null;

  @Allow()
  @Field(() => String, { nullable: true })
  body?: string | null;

  /** Ghost's branches never move once a request is open; any other base answers UNPROCESSABLE. */
  @Allow()
  @Field(() => String, { nullable: true })
  baseRefName?: string | null;

  @Allow()
  @Field(() => PullRequestUpdateState, { nullable: true })
  state?: PullRequestUpdateState | null;

  @Allow()
  @Field(() => [ID], { nullable: true })
  labelIds?: string[] | null;

  @Allow()
  @Field(() => [ID], { nullable: true })
  assigneeIds?: string[] | null;

  @Allow()
  @Field(() => ID, { nullable: true })
  milestoneId?: string | null;

  @Allow()
  @Field(() => [ID], { nullable: true })
  projectIds?: string[] | null;

  @Allow()
  @Field(() => Boolean, { nullable: true })
  maintainerCanModify?: boolean | null;

  @Allow()
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;
}

/** The input of every mutation that names a pull request and nothing else. */
@InputType({ isAbstract: true })
abstract class PullRequestIdInput {
  @Allow()
  @Field(() => ID)
  pullRequestId: string;

  @Allow()
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;
}

@InputType('ClosePullRequestInput')
export class ClosePullRequestInput extends PullRequestIdInput {}

@InputType('ReopenPullRequestInput')
export class ReopenPullRequestInput extends PullRequestIdInput {}

@InputType('MarkPullRequestReadyForReviewInput')
export class MarkPullRequestReadyForReviewInput extends PullRequestIdInput {}

@InputType('ConvertPullRequestToDraftInput')
export class ConvertPullRequestToDraftInput extends PullRequestIdInput {}

@InputType('MergePullRequestInput')
export class MergePullRequestInput extends PullRequestIdInput {
  @Allow()
  @Field(() => PullRequestMergeMethod, { nullable: true })
  mergeMethod?: PullRequestMergeMethod | null;

  @Allow()
  @Field(() => String, { nullable: true })
  commitHeadline?: string | null;

  @Allow()
  @Field(() => String, { nullable: true })
  commitBody?: string | null;

  /** The merge is refused unless the head is still this commit. */
  @Allow()
  @Field(() => GitObjectID, { nullable: true })
  expectedHeadOid?: string | null;

  // Accepted and ignored: a merge commit is credited to the merger, a squash to the request's author.
  @Allow()
  @Field(() => String, { nullable: true })
  authorEmail?: string | null;
}

@InputType('RequestReviewsInput')
export class RequestReviewsInput extends PullRequestIdInput {
  @Allow()
  @Field(() => [ID], { nullable: true })
  userIds?: string[] | null;

  @Allow()
  @Field(() => [ID], { nullable: true })
  teamIds?: string[] | null;

  /** Adds to the pending requests when true; otherwise the pending requests become exactly these. */
  @Allow()
  @Field(() => Boolean, { nullable: true, defaultValue: false })
  union?: boolean | null;
}

@ObjectType({ isAbstract: true })
abstract class PullRequestPayload {
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;

  @Field(() => PullRequestNode, { nullable: true })
  pullRequest: PullRequestNode | null;
}

@ObjectType('CreatePullRequestPayload')
export class CreatePullRequestPayload extends PullRequestPayload {}

@ObjectType('UpdatePullRequestPayload')
export class UpdatePullRequestPayload extends PullRequestPayload {}

@ObjectType('ClosePullRequestPayload')
export class ClosePullRequestPayload extends PullRequestPayload {}

@ObjectType('ReopenPullRequestPayload')
export class ReopenPullRequestPayload extends PullRequestPayload {}

@ObjectType('MergePullRequestPayload')
export class MergePullRequestPayload extends PullRequestPayload {}

@ObjectType('MarkPullRequestReadyForReviewPayload')
export class MarkPullRequestReadyForReviewPayload extends PullRequestPayload {}

@ObjectType('ConvertPullRequestToDraftPayload')
export class ConvertPullRequestToDraftPayload extends PullRequestPayload {}

@ObjectType('RequestReviewsPayload')
export class RequestReviewsPayload extends PullRequestPayload {}

/** The input of every mutation that names a review thread and nothing else. */
@InputType({ isAbstract: true })
abstract class ReviewThreadIdInput {
  @Allow()
  @Field(() => ID)
  threadId: string;

  @Allow()
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;
}

@InputType('ResolveReviewThreadInput')
export class ResolveReviewThreadInput extends ReviewThreadIdInput {}

@InputType('UnresolveReviewThreadInput')
export class UnresolveReviewThreadInput extends ReviewThreadIdInput {}

@ObjectType({ isAbstract: true })
abstract class ReviewThreadPayload {
  @Field(() => String, { nullable: true })
  clientMutationId?: string | null;

  @Field(() => PullRequestReviewThreadNode, { nullable: true })
  thread: PullRequestReviewThreadNode | null;
}

@ObjectType('ResolveReviewThreadPayload')
export class ResolveReviewThreadPayload extends ReviewThreadPayload {}

@ObjectType('UnresolveReviewThreadPayload')
export class UnresolveReviewThreadPayload extends ReviewThreadPayload {}
