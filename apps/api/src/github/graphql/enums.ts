import { registerEnumType } from '@nestjs/graphql';

export enum RepositoryVisibility {
  PRIVATE = 'PRIVATE',
  PUBLIC = 'PUBLIC',
}
registerEnumType(RepositoryVisibility, { name: 'RepositoryVisibility' });

export enum RepositoryPermission {
  ADMIN = 'ADMIN',
  MAINTAIN = 'MAINTAIN',
  WRITE = 'WRITE',
  TRIAGE = 'TRIAGE',
  READ = 'READ',
}
registerEnumType(RepositoryPermission, { name: 'RepositoryPermission' });

export enum IssueState {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}
registerEnumType(IssueState, { name: 'IssueState' });

export enum IssueStateReason {
  COMPLETED = 'COMPLETED',
  NOT_PLANNED = 'NOT_PLANNED',
  REOPENED = 'REOPENED',
  DUPLICATE = 'DUPLICATE',
}
registerEnumType(IssueStateReason, { name: 'IssueStateReason' });

export enum PullRequestState {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
  MERGED = 'MERGED',
}
registerEnumType(PullRequestState, { name: 'PullRequestState' });

export enum IssueOrderField {
  CREATED_AT = 'CREATED_AT',
  UPDATED_AT = 'UPDATED_AT',
  COMMENTS = 'COMMENTS',
}
registerEnumType(IssueOrderField, { name: 'IssueOrderField' });

export enum OrderDirection {
  ASC = 'ASC',
  DESC = 'DESC',
}
registerEnumType(OrderDirection, { name: 'OrderDirection' });

export enum CommentAuthorAssociation {
  OWNER = 'OWNER',
  MEMBER = 'MEMBER',
  COLLABORATOR = 'COLLABORATOR',
  CONTRIBUTOR = 'CONTRIBUTOR',
  FIRST_TIMER = 'FIRST_TIMER',
  FIRST_TIME_CONTRIBUTOR = 'FIRST_TIME_CONTRIBUTOR',
  MANNEQUIN = 'MANNEQUIN',
  NONE = 'NONE',
}
registerEnumType(CommentAuthorAssociation, {
  name: 'CommentAuthorAssociation',
});

export enum ReactionContent {
  THUMBS_UP = 'THUMBS_UP',
  THUMBS_DOWN = 'THUMBS_DOWN',
  LAUGH = 'LAUGH',
  HOORAY = 'HOORAY',
  CONFUSED = 'CONFUSED',
  HEART = 'HEART',
  ROCKET = 'ROCKET',
  EYES = 'EYES',
}
registerEnumType(ReactionContent, { name: 'ReactionContent' });

export enum ReportedContentClassifiers {
  SPAM = 'SPAM',
  ABUSE = 'ABUSE',
  OFF_TOPIC = 'OFF_TOPIC',
  OUTDATED = 'OUTDATED',
  DUPLICATE = 'DUPLICATE',
  RESOLVED = 'RESOLVED',
}
registerEnumType(ReportedContentClassifiers, {
  name: 'ReportedContentClassifiers',
});

export enum SearchType {
  ISSUE = 'ISSUE',
  REPOSITORY = 'REPOSITORY',
  USER = 'USER',
  DISCUSSION = 'DISCUSSION',
}
registerEnumType(SearchType, { name: 'SearchType' });

export enum IssueClosedStateReason {
  COMPLETED = 'COMPLETED',
  NOT_PLANNED = 'NOT_PLANNED',
  DUPLICATE = 'DUPLICATE',
}
registerEnumType(IssueClosedStateReason, { name: 'IssueClosedStateReason' });

export enum LabelOrderField {
  CREATED_AT = 'CREATED_AT',
  NAME = 'NAME',
}
registerEnumType(LabelOrderField, { name: 'LabelOrderField' });

export enum ReleaseOrderField {
  CREATED_AT = 'CREATED_AT',
  NAME = 'NAME',
}
registerEnumType(ReleaseOrderField, { name: 'ReleaseOrderField' });

export enum IssueTypeColor {
  BLUE = 'BLUE',
  GRAY = 'GRAY',
  GREEN = 'GREEN',
  ORANGE = 'ORANGE',
  PINK = 'PINK',
  PURPLE = 'PURPLE',
  RED = 'RED',
  YELLOW = 'YELLOW',
}
registerEnumType(IssueTypeColor, { name: 'IssueTypeColor' });

export enum MergeableState {
  MERGEABLE = 'MERGEABLE',
  CONFLICTING = 'CONFLICTING',
  UNKNOWN = 'UNKNOWN',
}
registerEnumType(MergeableState, { name: 'MergeableState' });

export enum MergeStateStatus {
  BEHIND = 'BEHIND',
  BLOCKED = 'BLOCKED',
  CLEAN = 'CLEAN',
  DIRTY = 'DIRTY',
  DRAFT = 'DRAFT',
  HAS_HOOKS = 'HAS_HOOKS',
  UNKNOWN = 'UNKNOWN',
  UNSTABLE = 'UNSTABLE',
}
registerEnumType(MergeStateStatus, { name: 'MergeStateStatus' });

export enum PullRequestReviewDecision {
  APPROVED = 'APPROVED',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  REVIEW_REQUIRED = 'REVIEW_REQUIRED',
}
registerEnumType(PullRequestReviewDecision, {
  name: 'PullRequestReviewDecision',
});

export enum PullRequestReviewState {
  APPROVED = 'APPROVED',
  CHANGES_REQUESTED = 'CHANGES_REQUESTED',
  COMMENTED = 'COMMENTED',
  DISMISSED = 'DISMISSED',
  PENDING = 'PENDING',
}
registerEnumType(PullRequestReviewState, { name: 'PullRequestReviewState' });

export enum PatchStatus {
  ADDED = 'ADDED',
  CHANGED = 'CHANGED',
  COPIED = 'COPIED',
  DELETED = 'DELETED',
  MODIFIED = 'MODIFIED',
  RENAMED = 'RENAMED',
}
registerEnumType(PatchStatus, { name: 'PatchStatus' });

export enum PullRequestMergeMethod {
  MERGE = 'MERGE',
  REBASE = 'REBASE',
  SQUASH = 'SQUASH',
}
registerEnumType(PullRequestMergeMethod, { name: 'PullRequestMergeMethod' });

export enum StatusState {
  ERROR = 'ERROR',
  EXPECTED = 'EXPECTED',
  FAILURE = 'FAILURE',
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
}
registerEnumType(StatusState, { name: 'StatusState' });

export enum CheckStatusState {
  COMPLETED = 'COMPLETED',
  IN_PROGRESS = 'IN_PROGRESS',
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  REQUESTED = 'REQUESTED',
  WAITING = 'WAITING',
}
registerEnumType(CheckStatusState, { name: 'CheckStatusState' });

export enum CheckConclusionState {
  ACTION_REQUIRED = 'ACTION_REQUIRED',
  CANCELLED = 'CANCELLED',
  FAILURE = 'FAILURE',
  NEUTRAL = 'NEUTRAL',
  SKIPPED = 'SKIPPED',
  STALE = 'STALE',
  STARTUP_FAILURE = 'STARTUP_FAILURE',
  SUCCESS = 'SUCCESS',
  TIMED_OUT = 'TIMED_OUT',
}
registerEnumType(CheckConclusionState, { name: 'CheckConclusionState' });

export enum PullRequestUpdateState {
  OPEN = 'OPEN',
  CLOSED = 'CLOSED',
}
registerEnumType(PullRequestUpdateState, { name: 'PullRequestUpdateState' });

export enum DiffSide {
  LEFT = 'LEFT',
  RIGHT = 'RIGHT',
}
registerEnumType(DiffSide, { name: 'DiffSide' });

export enum RepositoryRulesetTarget {
  BRANCH = 'BRANCH',
  TAG = 'TAG',
}
registerEnumType(RepositoryRulesetTarget, { name: 'RepositoryRulesetTarget' });

export enum RuleEnforcement {
  ACTIVE = 'ACTIVE',
  DISABLED = 'DISABLED',
}
registerEnumType(RuleEnforcement, { name: 'RuleEnforcement' });

export enum RepositoryRuleType {
  CREATION = 'CREATION',
  UPDATE = 'UPDATE',
  DELETION = 'DELETION',
  NON_FAST_FORWARD = 'NON_FAST_FORWARD',
  REQUIRED_LINEAR_HISTORY = 'REQUIRED_LINEAR_HISTORY',
  PULL_REQUEST = 'PULL_REQUEST',
}
registerEnumType(RepositoryRuleType, { name: 'RepositoryRuleType' });

export enum RepositoryRulesetBypassActorBypassMode {
  ALWAYS = 'ALWAYS',
  PULL_REQUEST = 'PULL_REQUEST',
}
registerEnumType(RepositoryRulesetBypassActorBypassMode, {
  name: 'RepositoryRulesetBypassActorBypassMode',
});

export enum PullRequestAllowedMergeMethods {
  MERGE = 'MERGE',
  SQUASH = 'SQUASH',
  REBASE = 'REBASE',
}
registerEnumType(PullRequestAllowedMergeMethods, {
  name: 'PullRequestAllowedMergeMethods',
});
