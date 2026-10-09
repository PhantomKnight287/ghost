import { registerEnumType } from '@nestjs/graphql';

export enum RepositoryVisibility { PRIVATE = 'PRIVATE', PUBLIC = 'PUBLIC' }
registerEnumType(RepositoryVisibility, { name: 'RepositoryVisibility' });

export enum RepositoryPermission { ADMIN = 'ADMIN', MAINTAIN = 'MAINTAIN', WRITE = 'WRITE', TRIAGE = 'TRIAGE', READ = 'READ' }
registerEnumType(RepositoryPermission, { name: 'RepositoryPermission' });

export enum IssueState { OPEN = 'OPEN', CLOSED = 'CLOSED' }
registerEnumType(IssueState, { name: 'IssueState' });

export enum IssueStateReason { COMPLETED = 'COMPLETED', NOT_PLANNED = 'NOT_PLANNED', REOPENED = 'REOPENED', DUPLICATE = 'DUPLICATE' }
registerEnumType(IssueStateReason, { name: 'IssueStateReason' });

export enum PullRequestState { OPEN = 'OPEN', CLOSED = 'CLOSED', MERGED = 'MERGED' }
registerEnumType(PullRequestState, { name: 'PullRequestState' });

export enum IssueOrderField { CREATED_AT = 'CREATED_AT', UPDATED_AT = 'UPDATED_AT', COMMENTS = 'COMMENTS' }
registerEnumType(IssueOrderField, { name: 'IssueOrderField' });

export enum OrderDirection { ASC = 'ASC', DESC = 'DESC' }
registerEnumType(OrderDirection, { name: 'OrderDirection' });

export enum CommentAuthorAssociation { OWNER = 'OWNER', MEMBER = 'MEMBER', COLLABORATOR = 'COLLABORATOR', CONTRIBUTOR = 'CONTRIBUTOR', FIRST_TIMER = 'FIRST_TIMER', FIRST_TIME_CONTRIBUTOR = 'FIRST_TIME_CONTRIBUTOR', MANNEQUIN = 'MANNEQUIN', NONE = 'NONE' }
registerEnumType(CommentAuthorAssociation, { name: 'CommentAuthorAssociation' });

export enum ReactionContent { THUMBS_UP = 'THUMBS_UP', THUMBS_DOWN = 'THUMBS_DOWN', LAUGH = 'LAUGH', HOORAY = 'HOORAY', CONFUSED = 'CONFUSED', HEART = 'HEART', ROCKET = 'ROCKET', EYES = 'EYES' }
registerEnumType(ReactionContent, { name: 'ReactionContent' });

export enum ReportedContentClassifiers { SPAM = 'SPAM', ABUSE = 'ABUSE', OFF_TOPIC = 'OFF_TOPIC', OUTDATED = 'OUTDATED', DUPLICATE = 'DUPLICATE', RESOLVED = 'RESOLVED' }
registerEnumType(ReportedContentClassifiers, { name: 'ReportedContentClassifiers' });

export enum SearchType { ISSUE = 'ISSUE', REPOSITORY = 'REPOSITORY', USER = 'USER', DISCUSSION = 'DISCUSSION' }
registerEnumType(SearchType, { name: 'SearchType' });
