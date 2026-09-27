CREATE TYPE "public"."diff_side" AS ENUM('deletions', 'additions');--> statement-breakpoint
CREATE TYPE "public"."pull_request_review_state" AS ENUM('commented', 'approved', 'changes_requested');--> statement-breakpoint
ALTER TYPE "public"."issue_event_type" ADD VALUE 'ready_for_review';--> statement-breakpoint
CREATE TABLE "pull_request_review" (
	"id" text PRIMARY KEY NOT NULL,
	"pullRequestId" text NOT NULL,
	"authorId" text NOT NULL,
	"state" "pull_request_review_state" NOT NULL,
	"body" text,
	"commitSha" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pull_request_review_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "pull_request_review_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"reviewId" text NOT NULL,
	"path" text NOT NULL,
	"side" "diff_side" NOT NULL,
	"line" integer NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pull_request_review_comment_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "draft" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_pullRequestId_pull_request_id_fk" FOREIGN KEY ("pullRequestId") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD CONSTRAINT "pull_request_review_comment_reviewId_pull_request_review_id_fk" FOREIGN KEY ("reviewId") REFERENCES "public"."pull_request_review"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_request_review_pull_idx" ON "pull_request_review" USING btree ("pullRequestId","createdAt");--> statement-breakpoint
CREATE INDEX "pull_request_review_comment_review_idx" ON "pull_request_review_comment" USING btree ("reviewId");