ALTER TABLE "issue_comment" ADD COLUMN "github_id" bigint;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_comment_issue_github_idx" ON "issue_comment" USING btree ("issue_id","github_id");