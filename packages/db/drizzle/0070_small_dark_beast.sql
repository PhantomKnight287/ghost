ALTER TYPE "public"."issue_event_type" ADD VALUE 'rules_bypassed';--> statement-breakpoint
ALTER TABLE "issue_event" ADD COLUMN "details" jsonb;--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "head_pushed_by_id" text;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD COLUMN "base_sha" text;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD COLUMN "resolved_by_id" text;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD COLUMN "resolved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_head_pushed_by_id_user_id_fk" FOREIGN KEY ("head_pushed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD CONSTRAINT "pull_request_review_comment_resolved_by_id_user_id_fk" FOREIGN KEY ("resolved_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;