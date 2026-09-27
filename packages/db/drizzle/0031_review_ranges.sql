ALTER TYPE "public"."issue_event_type" ADD VALUE 'converted_to_draft';--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD COLUMN "startSide" "diff_side";--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD COLUMN "startLine" integer;