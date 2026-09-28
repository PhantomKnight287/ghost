ALTER TABLE "repository" RENAME COLUMN "organizationId" TO "organization_id";--> statement-breakpoint
ALTER TABLE "repository" RENAME COLUMN "ownerId" TO "owner_id";--> statement-breakpoint
ALTER TABLE "repository" RENAME COLUMN "defaultBranch" TO "default_branch";--> statement-breakpoint
ALTER TABLE "repository" RENAME COLUMN "lastPushedAt" TO "last_pushed_at";--> statement-breakpoint
ALTER TABLE "repository" RENAME COLUMN "parentRepositoryId" TO "parent_repository_id";--> statement-breakpoint
ALTER TABLE "repository" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "repository" RENAME COLUMN "updatedAt" TO "updated_at";--> statement-breakpoint
ALTER TABLE "repository_language_index" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "repository_language_index" RENAME COLUMN "indexedCommitSha" TO "indexed_commit_sha";--> statement-breakpoint
ALTER TABLE "repository_language_index" RENAME COLUMN "updatedAt" TO "updated_at";--> statement-breakpoint
ALTER TABLE "repository_language_stat" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "repository_path_commit" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "repository_path_commit" RENAME COLUMN "commitSha" TO "commit_sha";--> statement-breakpoint
ALTER TABLE "repository_path_commit" RENAME COLUMN "committedAt" TO "committed_at";--> statement-breakpoint
ALTER TABLE "repository_ref_index" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "repository_ref_index" RENAME COLUMN "indexedCommitSha" TO "indexed_commit_sha";--> statement-breakpoint
ALTER TABLE "repository_ref_index" RENAME COLUMN "updatedAt" TO "updated_at";--> statement-breakpoint
ALTER TABLE "stars" RENAME COLUMN "userId" TO "user_id";--> statement-breakpoint
ALTER TABLE "stars" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "stars" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "stars" RENAME COLUMN "updatedAt" TO "updated_at";--> statement-breakpoint
ALTER TABLE "pull_request" RENAME COLUMN "issueId" TO "issue_id";--> statement-breakpoint
ALTER TABLE "pull_request" RENAME COLUMN "baseRepositoryId" TO "base_repository_id";--> statement-breakpoint
ALTER TABLE "pull_request" RENAME COLUMN "baseRef" TO "base_ref";--> statement-breakpoint
ALTER TABLE "pull_request" RENAME COLUMN "headRepositoryId" TO "head_repository_id";--> statement-breakpoint
ALTER TABLE "pull_request" RENAME COLUMN "headRef" TO "head_ref";--> statement-breakpoint
ALTER TABLE "pull_request" RENAME COLUMN "headSha" TO "head_sha";--> statement-breakpoint
ALTER TABLE "pull_request" RENAME COLUMN "mergeCommitSha" TO "merge_commit_sha";--> statement-breakpoint
ALTER TABLE "pull_request" RENAME COLUMN "mergedAt" TO "merged_at";--> statement-breakpoint
ALTER TABLE "pull_request_review" RENAME COLUMN "pullRequestId" TO "pull_request_id";--> statement-breakpoint
ALTER TABLE "pull_request_review" RENAME COLUMN "authorId" TO "author_id";--> statement-breakpoint
ALTER TABLE "pull_request_review" RENAME COLUMN "commitSha" TO "commit_sha";--> statement-breakpoint
ALTER TABLE "pull_request_review" RENAME COLUMN "dismissedById" TO "dismissed_by_id";--> statement-breakpoint
ALTER TABLE "pull_request_review" RENAME COLUMN "dismissalMessage" TO "dismissal_message";--> statement-breakpoint
ALTER TABLE "pull_request_review" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "pull_request_review" RENAME COLUMN "submittedAt" TO "submitted_at";--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" RENAME COLUMN "pullRequestId" TO "pull_request_id";--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" RENAME COLUMN "reviewId" TO "review_id";--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" RENAME COLUMN "inReplyToId" TO "in_reply_to_id";--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" RENAME COLUMN "authorId" TO "author_id";--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" RENAME COLUMN "startSide" TO "start_side";--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" RENAME COLUMN "startLine" TO "start_line";--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" RENAME COLUMN "commitSha" TO "commit_sha";--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" RENAME COLUMN "diffHunk" TO "diff_hunk";--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" RENAME COLUMN "updatedAt" TO "updated_at";--> statement-breakpoint
ALTER TABLE "issue" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "issue" RENAME COLUMN "isPullRequest" TO "is_pull_request";--> statement-breakpoint
ALTER TABLE "issue" RENAME COLUMN "authorId" TO "author_id";--> statement-breakpoint
ALTER TABLE "issue" RENAME COLUMN "closedById" TO "closed_by_id";--> statement-breakpoint
ALTER TABLE "issue" RENAME COLUMN "commentCount" TO "comment_count";--> statement-breakpoint
ALTER TABLE "issue" RENAME COLUMN "closedAt" TO "closed_at";--> statement-breakpoint
ALTER TABLE "issue" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "issue" RENAME COLUMN "updatedAt" TO "updated_at";--> statement-breakpoint
ALTER TABLE "issue_assignee" RENAME COLUMN "issueId" TO "issue_id";--> statement-breakpoint
ALTER TABLE "issue_assignee" RENAME COLUMN "userId" TO "user_id";--> statement-breakpoint
ALTER TABLE "issue_comment" RENAME COLUMN "issueId" TO "issue_id";--> statement-breakpoint
ALTER TABLE "issue_comment" RENAME COLUMN "authorId" TO "author_id";--> statement-breakpoint
ALTER TABLE "issue_comment" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "issue_comment" RENAME COLUMN "updatedAt" TO "updated_at";--> statement-breakpoint
ALTER TABLE "issue_event" RENAME COLUMN "issueId" TO "issue_id";--> statement-breakpoint
ALTER TABLE "issue_event" RENAME COLUMN "actorId" TO "actor_id";--> statement-breakpoint
ALTER TABLE "issue_event" RENAME COLUMN "labelName" TO "label_name";--> statement-breakpoint
ALTER TABLE "issue_event" RENAME COLUMN "assigneeUsername" TO "assignee_username";--> statement-breakpoint
ALTER TABLE "issue_event" RENAME COLUMN "oldTitle" TO "old_title";--> statement-breakpoint
ALTER TABLE "issue_event" RENAME COLUMN "newTitle" TO "new_title";--> statement-breakpoint
ALTER TABLE "issue_event" RENAME COLUMN "sourceIssueId" TO "source_issue_id";--> statement-breakpoint
ALTER TABLE "issue_event" RENAME COLUMN "commitSha" TO "commit_sha";--> statement-breakpoint
ALTER TABLE "issue_event" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "issue_label" RENAME COLUMN "issueId" TO "issue_id";--> statement-breakpoint
ALTER TABLE "issue_label" RENAME COLUMN "labelId" TO "label_id";--> statement-breakpoint
ALTER TABLE "issue_reference" RENAME COLUMN "sourceType" TO "source_type";--> statement-breakpoint
ALTER TABLE "issue_reference" RENAME COLUMN "sourceId" TO "source_id";--> statement-breakpoint
ALTER TABLE "issue_reference" RENAME COLUMN "sourceRepositoryId" TO "source_repository_id";--> statement-breakpoint
ALTER TABLE "issue_reference" RENAME COLUMN "sourceIssueId" TO "source_issue_id";--> statement-breakpoint
ALTER TABLE "issue_reference" RENAME COLUMN "targetIssueId" TO "target_issue_id";--> statement-breakpoint
ALTER TABLE "issue_reference" RENAME COLUMN "actorId" TO "actor_id";--> statement-breakpoint
ALTER TABLE "issue_reference" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "label" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "label" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "label" RENAME COLUMN "updatedAt" TO "updated_at";--> statement-breakpoint
ALTER TABLE "repository_collaborator" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "repository_collaborator" RENAME COLUMN "userId" TO "user_id";--> statement-breakpoint
ALTER TABLE "repository_collaborator" RENAME COLUMN "invitedById" TO "invited_by_id";--> statement-breakpoint
ALTER TABLE "repository_collaborator" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "repository_collaborator" RENAME COLUMN "acceptedAt" TO "accepted_at";--> statement-breakpoint
ALTER TABLE "repository_team" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "repository_team" RENAME COLUMN "teamId" TO "team_id";--> statement-breakpoint
ALTER TABLE "repository_team" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "organization_pinned_repository" RENAME COLUMN "organizationId" TO "organization_id";--> statement-breakpoint
ALTER TABLE "organization_pinned_repository" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "organization_public_member" RENAME COLUMN "organizationId" TO "organization_id";--> statement-breakpoint
ALTER TABLE "organization_public_member" RENAME COLUMN "userId" TO "user_id";--> statement-breakpoint
ALTER TABLE "organization_settings" RENAME COLUMN "organizationId" TO "organization_id";--> statement-breakpoint
ALTER TABLE "organization_settings" RENAME COLUMN "basePermission" TO "base_permission";--> statement-breakpoint
ALTER TABLE "organization_settings" RENAME COLUMN "membersCanCreatePublicRepositories" TO "members_can_create_public_repositories";--> statement-breakpoint
ALTER TABLE "organization_settings" RENAME COLUMN "membersCanCreatePrivateRepositories" TO "members_can_create_private_repositories";--> statement-breakpoint
ALTER TABLE "organization_settings" RENAME COLUMN "allowPrivateForks" TO "allow_private_forks";--> statement-breakpoint
ALTER TABLE "organization_settings" RENAME COLUMN "defaultBranch" TO "default_branch";--> statement-breakpoint
ALTER TABLE "organization_settings" RENAME COLUMN "updatedAt" TO "updated_at";--> statement-breakpoint
ALTER TABLE "repository_redirect" RENAME COLUMN "ownerName" TO "owner_name";--> statement-breakpoint
ALTER TABLE "repository_redirect" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "repository_redirect" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "repository_transfer" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "repository_transfer" RENAME COLUMN "toUserId" TO "to_user_id";--> statement-breakpoint
ALTER TABLE "repository_transfer" RENAME COLUMN "toOrganizationId" TO "to_organization_id";--> statement-breakpoint
ALTER TABLE "repository_transfer" RENAME COLUMN "requestedById" TO "requested_by_id";--> statement-breakpoint
ALTER TABLE "repository_transfer" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "team_maintainer" RENAME COLUMN "teamId" TO "team_id";--> statement-breakpoint
ALTER TABLE "team_maintainer" RENAME COLUMN "userId" TO "user_id";--> statement-breakpoint
ALTER TABLE "release" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "release" RENAME COLUMN "tagName" TO "tag_name";--> statement-breakpoint
ALTER TABLE "release" RENAME COLUMN "isDraft" TO "is_draft";--> statement-breakpoint
ALTER TABLE "release" RENAME COLUMN "isPrerelease" TO "is_prerelease";--> statement-breakpoint
ALTER TABLE "release" RENAME COLUMN "authorId" TO "author_id";--> statement-breakpoint
ALTER TABLE "release" RENAME COLUMN "publishedAt" TO "published_at";--> statement-breakpoint
ALTER TABLE "release" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "release" RENAME COLUMN "updatedAt" TO "updated_at";--> statement-breakpoint
ALTER TABLE "release_asset" RENAME COLUMN "releaseId" TO "release_id";--> statement-breakpoint
ALTER TABLE "release_asset" RENAME COLUMN "repositoryId" TO "repository_id";--> statement-breakpoint
ALTER TABLE "release_asset" RENAME COLUMN "contentType" TO "content_type";--> statement-breakpoint
ALTER TABLE "release_asset" RENAME COLUMN "downloadCount" TO "download_count";--> statement-breakpoint
ALTER TABLE "release_asset" RENAME COLUMN "uploaderId" TO "uploader_id";--> statement-breakpoint
ALTER TABLE "release_asset" RENAME COLUMN "createdAt" TO "created_at";--> statement-breakpoint
ALTER TABLE "pull_request" DROP CONSTRAINT "pull_request_issueId_unique";--> statement-breakpoint
ALTER TABLE "repository" DROP CONSTRAINT "repository_organizationId_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "repository" DROP CONSTRAINT "repository_ownerId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "repository" DROP CONSTRAINT "repository_parentRepositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_language_index" DROP CONSTRAINT "repository_language_index_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_language_stat" DROP CONSTRAINT "repository_language_stat_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_path_commit" DROP CONSTRAINT "repository_path_commit_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_ref_index" DROP CONSTRAINT "repository_ref_index_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "stars" DROP CONSTRAINT "stars_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "stars" DROP CONSTRAINT "stars_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_request" DROP CONSTRAINT "pull_request_issueId_issue_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_request" DROP CONSTRAINT "pull_request_baseRepositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_request" DROP CONSTRAINT "pull_request_headRepositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_request_review" DROP CONSTRAINT "pull_request_review_pullRequestId_pull_request_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_request_review" DROP CONSTRAINT "pull_request_review_authorId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_request_review" DROP CONSTRAINT "pull_request_review_dismissedById_user_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" DROP CONSTRAINT "pull_request_review_comment_pullRequestId_pull_request_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" DROP CONSTRAINT "pull_request_review_comment_reviewId_pull_request_review_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" DROP CONSTRAINT "pull_request_review_comment_inReplyToId_pull_request_review_comment_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" DROP CONSTRAINT "pull_request_review_comment_authorId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "issue" DROP CONSTRAINT "issue_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "issue" DROP CONSTRAINT "issue_authorId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "issue" DROP CONSTRAINT "issue_closedById_user_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_assignee" DROP CONSTRAINT "issue_assignee_issueId_issue_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_assignee" DROP CONSTRAINT "issue_assignee_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_comment" DROP CONSTRAINT "issue_comment_issueId_issue_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_comment" DROP CONSTRAINT "issue_comment_authorId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_event" DROP CONSTRAINT "issue_event_issueId_issue_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_event" DROP CONSTRAINT "issue_event_actorId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_event" DROP CONSTRAINT "issue_event_sourceIssueId_issue_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_label" DROP CONSTRAINT "issue_label_issueId_issue_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_label" DROP CONSTRAINT "issue_label_labelId_label_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_reference" DROP CONSTRAINT "issue_reference_sourceRepositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_reference" DROP CONSTRAINT "issue_reference_sourceIssueId_issue_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_reference" DROP CONSTRAINT "issue_reference_targetIssueId_issue_id_fk";
--> statement-breakpoint
ALTER TABLE "issue_reference" DROP CONSTRAINT "issue_reference_actorId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "label" DROP CONSTRAINT "label_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_collaborator" DROP CONSTRAINT "repository_collaborator_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_collaborator" DROP CONSTRAINT "repository_collaborator_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_collaborator" DROP CONSTRAINT "repository_collaborator_invitedById_user_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_team" DROP CONSTRAINT "repository_team_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_team" DROP CONSTRAINT "repository_team_teamId_team_id_fk";
--> statement-breakpoint
ALTER TABLE "organization_pinned_repository" DROP CONSTRAINT "organization_pinned_repository_organizationId_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "organization_pinned_repository" DROP CONSTRAINT "organization_pinned_repository_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "organization_public_member" DROP CONSTRAINT "organization_public_member_organizationId_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "organization_public_member" DROP CONSTRAINT "organization_public_member_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "organization_settings" DROP CONSTRAINT "organization_settings_organizationId_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_redirect" DROP CONSTRAINT "repository_redirect_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_transfer" DROP CONSTRAINT "repository_transfer_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_transfer" DROP CONSTRAINT "repository_transfer_toUserId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_transfer" DROP CONSTRAINT "repository_transfer_toOrganizationId_organization_id_fk";
--> statement-breakpoint
ALTER TABLE "repository_transfer" DROP CONSTRAINT "repository_transfer_requestedById_user_id_fk";
--> statement-breakpoint
ALTER TABLE "team_maintainer" DROP CONSTRAINT "team_maintainer_teamId_team_id_fk";
--> statement-breakpoint
ALTER TABLE "team_maintainer" DROP CONSTRAINT "team_maintainer_userId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "release" DROP CONSTRAINT "release_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "release" DROP CONSTRAINT "release_authorId_user_id_fk";
--> statement-breakpoint
ALTER TABLE "release_asset" DROP CONSTRAINT "release_asset_releaseId_release_id_fk";
--> statement-breakpoint
ALTER TABLE "release_asset" DROP CONSTRAINT "release_asset_repositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "release_asset" DROP CONSTRAINT "release_asset_uploaderId_user_id_fk";
--> statement-breakpoint
DROP INDEX "stars_userId_repositoryId_index";--> statement-breakpoint
DROP INDEX "repository_org_slug_idx";--> statement-breakpoint
DROP INDEX "repository_owner_slug_idx";--> statement-breakpoint
DROP INDEX "pull_request_open_branch_idx";--> statement-breakpoint
DROP INDEX "pull_request_head_idx";--> statement-breakpoint
DROP INDEX "pull_request_base_state_idx";--> statement-breakpoint
DROP INDEX "pull_request_review_pull_idx";--> statement-breakpoint
DROP INDEX "pull_request_review_pending_idx";--> statement-breakpoint
DROP INDEX "pull_request_review_comment_review_idx";--> statement-breakpoint
DROP INDEX "pull_request_review_comment_reply_idx";--> statement-breakpoint
DROP INDEX "pull_request_review_comment_pull_idx";--> statement-breakpoint
DROP INDEX "issue_repo_number_idx";--> statement-breakpoint
DROP INDEX "issue_repo_kind_state_idx";--> statement-breakpoint
DROP INDEX "issue_repo_updated_idx";--> statement-breakpoint
DROP INDEX "issue_comment_issue_idx";--> statement-breakpoint
DROP INDEX "issue_event_issue_idx";--> statement-breakpoint
DROP INDEX "issue_reference_source_target_idx";--> statement-breakpoint
DROP INDEX "issue_reference_target_idx";--> statement-breakpoint
DROP INDEX "issue_reference_source_issue_idx";--> statement-breakpoint
DROP INDEX "label_repo_name_idx";--> statement-breakpoint
DROP INDEX "label_repo_idx";--> statement-breakpoint
DROP INDEX "repository_collaborator_repository_user_idx";--> statement-breakpoint
DROP INDEX "repository_collaborator_user_idx";--> statement-breakpoint
DROP INDEX "repository_team_team_idx";--> statement-breakpoint
DROP INDEX "repository_redirect_name_idx";--> statement-breakpoint
DROP INDEX "repository_redirect_repository_idx";--> statement-breakpoint
DROP INDEX "release_repository_tag_idx";--> statement-breakpoint
DROP INDEX "release_repository_created_idx";--> statement-breakpoint
DROP INDEX "release_asset_release_name_idx";--> statement-breakpoint
DROP INDEX "release_asset_repository_idx";--> statement-breakpoint
ALTER TABLE "repository_language_index" DROP CONSTRAINT "repository_language_index_repositoryId_ref_pk";--> statement-breakpoint
ALTER TABLE "repository_language_stat" DROP CONSTRAINT "repository_language_stat_repositoryId_ref_language_pk";--> statement-breakpoint
ALTER TABLE "repository_path_commit" DROP CONSTRAINT "repository_path_commit_repositoryId_ref_path_pk";--> statement-breakpoint
ALTER TABLE "repository_ref_index" DROP CONSTRAINT "repository_ref_index_repositoryId_ref_pk";--> statement-breakpoint
ALTER TABLE "issue_assignee" DROP CONSTRAINT "issue_assignee_issueId_userId_pk";--> statement-breakpoint
ALTER TABLE "issue_label" DROP CONSTRAINT "issue_label_issueId_labelId_pk";--> statement-breakpoint
ALTER TABLE "repository_team" DROP CONSTRAINT "repository_team_repositoryId_teamId_pk";--> statement-breakpoint
ALTER TABLE "organization_pinned_repository" DROP CONSTRAINT "organization_pinned_repository_organizationId_repositoryId_pk";--> statement-breakpoint
ALTER TABLE "organization_public_member" DROP CONSTRAINT "organization_public_member_organizationId_userId_pk";--> statement-breakpoint
ALTER TABLE "team_maintainer" DROP CONSTRAINT "team_maintainer_teamId_userId_pk";--> statement-breakpoint
ALTER TABLE "repository_language_index" ADD CONSTRAINT "repository_language_index_repository_id_ref_pk" PRIMARY KEY("repository_id","ref");--> statement-breakpoint
ALTER TABLE "repository_language_stat" ADD CONSTRAINT "repository_language_stat_repository_id_ref_language_pk" PRIMARY KEY("repository_id","ref","language");--> statement-breakpoint
ALTER TABLE "repository_path_commit" ADD CONSTRAINT "repository_path_commit_repository_id_ref_path_pk" PRIMARY KEY("repository_id","ref","path");--> statement-breakpoint
ALTER TABLE "repository_ref_index" ADD CONSTRAINT "repository_ref_index_repository_id_ref_pk" PRIMARY KEY("repository_id","ref");--> statement-breakpoint
ALTER TABLE "issue_assignee" ADD CONSTRAINT "issue_assignee_issue_id_user_id_pk" PRIMARY KEY("issue_id","user_id");--> statement-breakpoint
ALTER TABLE "issue_label" ADD CONSTRAINT "issue_label_issue_id_label_id_pk" PRIMARY KEY("issue_id","label_id");--> statement-breakpoint
ALTER TABLE "repository_team" ADD CONSTRAINT "repository_team_repository_id_team_id_pk" PRIMARY KEY("repository_id","team_id");--> statement-breakpoint
ALTER TABLE "organization_pinned_repository" ADD CONSTRAINT "organization_pinned_repository_organization_id_repository_id_pk" PRIMARY KEY("organization_id","repository_id");--> statement-breakpoint
ALTER TABLE "organization_public_member" ADD CONSTRAINT "organization_public_member_organization_id_user_id_pk" PRIMARY KEY("organization_id","user_id");--> statement-breakpoint
ALTER TABLE "team_maintainer" ADD CONSTRAINT "team_maintainer_team_id_user_id_pk" PRIMARY KEY("team_id","user_id");--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_parent_repository_id_repository_id_fk" FOREIGN KEY ("parent_repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_language_index" ADD CONSTRAINT "repository_language_index_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_language_stat" ADD CONSTRAINT "repository_language_stat_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_path_commit" ADD CONSTRAINT "repository_path_commit_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_ref_index" ADD CONSTRAINT "repository_ref_index_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_base_repository_id_repository_id_fk" FOREIGN KEY ("base_repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_head_repository_id_repository_id_fk" FOREIGN KEY ("head_repository_id") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_dismissed_by_id_user_id_fk" FOREIGN KEY ("dismissed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD CONSTRAINT "pull_request_review_comment_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD CONSTRAINT "pull_request_review_comment_review_id_pull_request_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."pull_request_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD CONSTRAINT "pull_request_review_comment_in_reply_to_id_pull_request_review_comment_id_fk" FOREIGN KEY ("in_reply_to_id") REFERENCES "public"."pull_request_review_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD CONSTRAINT "pull_request_review_comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_closed_by_id_user_id_fk" FOREIGN KEY ("closed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_assignee" ADD CONSTRAINT "issue_assignee_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_assignee" ADD CONSTRAINT "issue_assignee_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_event" ADD CONSTRAINT "issue_event_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_event" ADD CONSTRAINT "issue_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_event" ADD CONSTRAINT "issue_event_source_issue_id_issue_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_label" ADD CONSTRAINT "issue_label_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_label" ADD CONSTRAINT "issue_label_label_id_label_id_fk" FOREIGN KEY ("label_id") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference" ADD CONSTRAINT "issue_reference_source_repository_id_repository_id_fk" FOREIGN KEY ("source_repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference" ADD CONSTRAINT "issue_reference_source_issue_id_issue_id_fk" FOREIGN KEY ("source_issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference" ADD CONSTRAINT "issue_reference_target_issue_id_issue_id_fk" FOREIGN KEY ("target_issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference" ADD CONSTRAINT "issue_reference_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_collaborator" ADD CONSTRAINT "repository_collaborator_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_collaborator" ADD CONSTRAINT "repository_collaborator_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_collaborator" ADD CONSTRAINT "repository_collaborator_invited_by_id_user_id_fk" FOREIGN KEY ("invited_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_team" ADD CONSTRAINT "repository_team_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_team" ADD CONSTRAINT "repository_team_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_pinned_repository" ADD CONSTRAINT "organization_pinned_repository_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_pinned_repository" ADD CONSTRAINT "organization_pinned_repository_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_public_member" ADD CONSTRAINT "organization_public_member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_public_member" ADD CONSTRAINT "organization_public_member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_redirect" ADD CONSTRAINT "repository_redirect_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_transfer" ADD CONSTRAINT "repository_transfer_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_transfer" ADD CONSTRAINT "repository_transfer_to_user_id_user_id_fk" FOREIGN KEY ("to_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_transfer" ADD CONSTRAINT "repository_transfer_to_organization_id_organization_id_fk" FOREIGN KEY ("to_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_transfer" ADD CONSTRAINT "repository_transfer_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_maintainer" ADD CONSTRAINT "team_maintainer_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_maintainer" ADD CONSTRAINT "team_maintainer_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_asset" ADD CONSTRAINT "release_asset_release_id_release_id_fk" FOREIGN KEY ("release_id") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_asset" ADD CONSTRAINT "release_asset_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_asset" ADD CONSTRAINT "release_asset_uploader_id_user_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stars_user_id_repository_id_index" ON "stars" USING btree ("user_id","repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_org_slug_idx" ON "repository" USING btree ("organization_id","slug") WHERE "repository"."organization_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_owner_slug_idx" ON "repository" USING btree ("owner_id","slug") WHERE "repository"."organization_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_open_branch_idx" ON "pull_request" USING btree ("base_repository_id","base_ref","head_repository_id","head_ref") WHERE "pull_request"."state" = 'open';--> statement-breakpoint
CREATE INDEX "pull_request_head_idx" ON "pull_request" USING btree ("head_repository_id");--> statement-breakpoint
CREATE INDEX "pull_request_base_state_idx" ON "pull_request" USING btree ("base_repository_id","state");--> statement-breakpoint
CREATE INDEX "pull_request_review_pull_idx" ON "pull_request_review" USING btree ("pull_request_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_review_pending_idx" ON "pull_request_review" USING btree ("pull_request_id","author_id") WHERE "pull_request_review"."submitted_at" is null;--> statement-breakpoint
CREATE INDEX "pull_request_review_comment_review_idx" ON "pull_request_review_comment" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "pull_request_review_comment_reply_idx" ON "pull_request_review_comment" USING btree ("in_reply_to_id");--> statement-breakpoint
CREATE INDEX "pull_request_review_comment_pull_idx" ON "pull_request_review_comment" USING btree ("pull_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_repo_number_idx" ON "issue" USING btree ("repository_id","number");--> statement-breakpoint
CREATE INDEX "issue_repo_kind_state_idx" ON "issue" USING btree ("repository_id","is_pull_request","state");--> statement-breakpoint
CREATE INDEX "issue_repo_updated_idx" ON "issue" USING btree ("repository_id","updated_at");--> statement-breakpoint
CREATE INDEX "issue_comment_issue_idx" ON "issue_comment" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_event_issue_idx" ON "issue_event" USING btree ("issue_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "issue_reference_source_target_idx" ON "issue_reference" USING btree ("source_type","source_id","target_issue_id");--> statement-breakpoint
CREATE INDEX "issue_reference_target_idx" ON "issue_reference" USING btree ("target_issue_id","created_at");--> statement-breakpoint
CREATE INDEX "issue_reference_source_issue_idx" ON "issue_reference" USING btree ("source_issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "label_repo_name_idx" ON "label" USING btree ("repository_id","name");--> statement-breakpoint
CREATE INDEX "label_repo_idx" ON "label" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_collaborator_repository_user_idx" ON "repository_collaborator" USING btree ("repository_id","user_id");--> statement-breakpoint
CREATE INDEX "repository_collaborator_user_idx" ON "repository_collaborator" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "repository_team_team_idx" ON "repository_team" USING btree ("team_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repository_redirect_name_idx" ON "repository_redirect" USING btree (lower("owner_name"),"slug");--> statement-breakpoint
CREATE INDEX "repository_redirect_repository_idx" ON "repository_redirect" USING btree ("repository_id");--> statement-breakpoint
CREATE UNIQUE INDEX "release_repository_tag_idx" ON "release" USING btree ("repository_id","tag_name");--> statement-breakpoint
CREATE INDEX "release_repository_created_idx" ON "release" USING btree ("repository_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "release_asset_release_name_idx" ON "release_asset" USING btree ("release_id","name");--> statement-breakpoint
CREATE INDEX "release_asset_repository_idx" ON "release_asset" USING btree ("repository_id");--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_issueId_unique" UNIQUE("issue_id");