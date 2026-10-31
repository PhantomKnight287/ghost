import type { AppPermission } from '@ghost/permissions';
import type { FieldMiddleware } from '@nestjs/graphql';

import type { GithubRequest } from '../../github/auth/github-request.js';
import { IntegrationForbiddenError } from './apps.errors.js';
import { grants } from './permissions.js';

type Level = 'read' | 'write';
/** One permission, or any of several. */
type Needs = AppPermission | AppPermission[];

/** What an installation token needs to read each GraphQL object type's fields. A type missing here is denied, so a new type has to be mapped before a bot can read it. */
export const GRAPHQL_TYPE_PERMISSIONS: Record<string, Needs> = {
  AddAssigneesToAssignablePayload: 'metadata',
  AddCommentPayload: 'metadata',
  AddLabelsToLabelablePayload: 'metadata',
  App: 'metadata',
  AutoMergeRequest: 'pull_requests',
  Bot: 'metadata',
  BranchProtectionRule: 'metadata',
  CheckRun: 'statuses',
  CheckSuite: 'statuses',
  CloseIssuePayload: 'metadata',
  ClosePullRequestPayload: 'metadata',
  Commit: 'contents',
  ConvertPullRequestToDraftPayload: 'metadata',
  CreateIssuePayload: 'metadata',
  CreatePullRequestPayload: 'metadata',
  CreateRepositoryPayload: 'metadata',
  GitActor: 'contents',
  GitActorConnection: 'contents',
  Issue: 'issues',
  IssueComment: ['issues', 'pull_requests'],
  IssueCommentConnection: ['issues', 'pull_requests'],
  IssueCommentEdge: ['issues', 'pull_requests'],
  IssueConnection: 'issues',
  IssueType: 'issues',
  Label: 'metadata',
  LabelConnection: 'metadata',
  MarkPullRequestReadyForReviewPayload: 'metadata',
  MergePullRequestPayload: 'metadata',
  Milestone: ['issues', 'pull_requests'],
  Organization: 'metadata',
  PageInfo: 'metadata',
  ProjectV2: 'issues',
  ProjectV2Item: 'issues',
  ProjectV2ItemConnection: 'issues',
  ProjectV2ItemFieldSingleSelectValue: 'issues',
  PullRequest: 'pull_requests',
  PullRequestChangedFile: 'pull_requests',
  PullRequestChangedFileConnection: 'pull_requests',
  PullRequestCommit: 'pull_requests',
  PullRequestCommitConnection: 'pull_requests',
  PullRequestConnection: 'pull_requests',
  PullRequestEdge: 'pull_requests',
  PullRequestParameters: 'metadata',
  PullRequestReview: 'pull_requests',
  PullRequestReviewComment: 'pull_requests',
  PullRequestReviewCommentConnection: 'pull_requests',
  PullRequestReviewConnection: 'pull_requests',
  PullRequestReviewThread: 'pull_requests',
  PullRequestReviewThreadConnection: 'pull_requests',
  ReactingUserConnection: 'metadata',
  ReactionGroup: 'metadata',
  Ref: 'metadata',
  RefNameConditionTarget: 'metadata',
  Release: 'contents',
  ReleaseConnection: 'contents',
  RemoveAssigneesFromAssignablePayload: 'metadata',
  RemoveLabelsFromLabelablePayload: 'metadata',
  ReopenIssuePayload: 'metadata',
  ReopenPullRequestPayload: 'metadata',
  Repository: 'metadata',
  RepositoryRule: 'metadata',
  RepositoryRuleConditions: 'metadata',
  RepositoryRuleConnection: 'metadata',
  RepositoryRuleset: 'metadata',
  RepositoryRulesetBypassActor: 'metadata',
  RepositoryRulesetBypassActorConnection: 'metadata',
  RepositoryRulesetConnection: 'metadata',
  RequestReviewsPayload: 'metadata',
  RequiredStatusChecksParameters: 'metadata',
  ResolveReviewThreadPayload: 'metadata',
  ReviewRequest: 'pull_requests',
  ReviewRequestConnection: 'pull_requests',
  SearchResultItemConnection: 'metadata',
  SearchResultItemEdge: 'metadata',
  StatusCheckConfiguration: 'metadata',
  StatusCheckRollup: 'statuses',
  StatusCheckRollupContextConnection: 'statuses',
  StatusContext: 'statuses',
  SubIssuesSummary: 'issues',
  Team: 'metadata',
  TeamConnection: 'metadata',
  UnresolveReviewThreadPayload: 'metadata',
  UpdateIssuePayload: 'metadata',
  UpdatePullRequestPayload: 'metadata',
  User: 'metadata',
  UserConnection: 'metadata',
  Workflow: 'statuses',
  WorkflowRun: 'statuses',
};

/** Root fields, each with its level. `node` and `nodes` are safe at metadata: whatever they return is held to its own type's permission. A root field missing here is denied. */
export const GRAPHQL_ROOT_PERMISSIONS: Record<
  string,
  Partial<Record<AppPermission, Level>>
> = {
  'Query.viewer': { metadata: 'read' },
  'Query.user': { metadata: 'read' },
  'Query.organization': { metadata: 'read' },
  'Query.repositoryOwner': { metadata: 'read' },
  'Query.repository': { metadata: 'read' },
  'Query.node': { metadata: 'read' },
  'Query.nodes': { metadata: 'read' },
  'Query.search': { metadata: 'read' },
  'Mutation.createIssue': { issues: 'write' },
  'Mutation.updateIssue': { issues: 'write' },
  'Mutation.closeIssue': { issues: 'write' },
  'Mutation.reopenIssue': { issues: 'write' },
  'Mutation.addComment': { issues: 'write' },
  'Mutation.addLabelsToLabelable': { issues: 'write' },
  'Mutation.removeLabelsFromLabelable': { issues: 'write' },
  'Mutation.addAssigneesToAssignable': { issues: 'write' },
  'Mutation.removeAssigneesFromAssignable': { issues: 'write' },
  'Mutation.createPullRequest': { pull_requests: 'write' },
  'Mutation.updatePullRequest': { pull_requests: 'write' },
  'Mutation.closePullRequest': { pull_requests: 'write' },
  'Mutation.reopenPullRequest': { pull_requests: 'write' },
  'Mutation.markPullRequestReadyForReview': { pull_requests: 'write' },
  'Mutation.convertPullRequestToDraft': { pull_requests: 'write' },
  'Mutation.requestReviews': { pull_requests: 'write' },
  'Mutation.resolveReviewThread': { pull_requests: 'write' },
  'Mutation.unresolveReviewThread': { pull_requests: 'write' },
  'Mutation.mergePullRequest': { pull_requests: 'write', contents: 'write' },
};

/** Holds an installation token to the type map on every object field it resolves; root fields are AppPermissionGuard's, since Nest runs guards on them but not this. Anyone else passes untouched. */
export const appPermissionMiddleware: FieldMiddleware = (
  { context, info },
  next,
) => {
  const held = (context as { req: GithubRequest }).req.appInstallation
    ?.permissions;
  if (!held) return next();
  // Apollo always passes the resolve info to a field resolver.
  const needs = GRAPHQL_TYPE_PERMISSIONS[info!.parentType.name] ?? [];
  if (![needs].flat().some((name) => grants(held, name, 'read')))
    throw new IntegrationForbiddenError();
  return next();
};
