ALTER TABLE "repository_contribution_index" ADD COLUMN "commit_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Forget every index so the next sync rebuilds it: co-authors were never credited and commit_count starts at 0.
DELETE FROM "repository_contribution_index";
