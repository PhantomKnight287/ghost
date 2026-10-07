ALTER TYPE "public"."issue_event_type" ADD VALUE 'committed';--> statement-breakpoint
ALTER TYPE "public"."issue_event_type" ADD VALUE 'head_force_pushed';--> statement-breakpoint
ALTER TABLE "issue_event" ADD COLUMN "before_sha" text;--> statement-breakpoint
ALTER TABLE "issue_event" ADD COLUMN "commit_message" text;--> statement-breakpoint
ALTER TABLE "issue_event" ADD COLUMN "commit_author_name" text;