CREATE TYPE "public"."review_request_cleared_reason" AS ENUM('reviewed', 'removed');--> statement-breakpoint
ALTER TYPE "public"."issue_event_type" ADD VALUE 'review_requested';--> statement-breakpoint
ALTER TYPE "public"."issue_event_type" ADD VALUE 'review_request_removed';--> statement-breakpoint
ALTER TYPE "public"."notification_reason" ADD VALUE 'review_requested';--> statement-breakpoint
CREATE TABLE "pull_request_review_on_behalf_of" (
	"review_id" text NOT NULL,
	"team_id" text NOT NULL,
	CONSTRAINT "pull_request_review_on_behalf_of_review_id_team_id_pk" PRIMARY KEY("review_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "pull_request_review_request" (
	"id" text PRIMARY KEY NOT NULL,
	"pull_request_id" text NOT NULL,
	"reviewer_user_id" text,
	"reviewer_team_id" text,
	"requested_by_id" text,
	"as_code_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cleared_at" timestamp with time zone,
	"cleared_reason" "review_request_cleared_reason",
	CONSTRAINT "pull_request_review_request_id_unique" UNIQUE("id"),
	CONSTRAINT "pull_request_review_request_one_reviewer" CHECK (("pull_request_review_request"."reviewer_user_id" is null) <> ("pull_request_review_request"."reviewer_team_id" is null))
);
--> statement-breakpoint
ALTER TABLE "issue_event" ADD COLUMN "requested_reviewer_username" text;--> statement-breakpoint
ALTER TABLE "issue_event" ADD COLUMN "requested_team_slug" text;--> statement-breakpoint
ALTER TABLE "pull_request_review_on_behalf_of" ADD CONSTRAINT "pull_request_review_on_behalf_of_review_id_pull_request_review_id_fk" FOREIGN KEY ("review_id") REFERENCES "public"."pull_request_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_on_behalf_of" ADD CONSTRAINT "pull_request_review_on_behalf_of_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_request" ADD CONSTRAINT "pull_request_review_request_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_request" ADD CONSTRAINT "pull_request_review_request_reviewer_user_id_user_id_fk" FOREIGN KEY ("reviewer_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_request" ADD CONSTRAINT "pull_request_review_request_reviewer_team_id_team_id_fk" FOREIGN KEY ("reviewer_team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_request" ADD CONSTRAINT "pull_request_review_request_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_review_request_pending_user_idx" ON "pull_request_review_request" USING btree ("pull_request_id","reviewer_user_id") WHERE "pull_request_review_request"."cleared_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_review_request_pending_team_idx" ON "pull_request_review_request" USING btree ("pull_request_id","reviewer_team_id") WHERE "pull_request_review_request"."cleared_at" is null;--> statement-breakpoint
CREATE INDEX "pull_request_review_request_user_idx" ON "pull_request_review_request" USING btree ("reviewer_user_id");--> statement-breakpoint
CREATE INDEX "pull_request_review_request_team_idx" ON "pull_request_review_request" USING btree ("reviewer_team_id");