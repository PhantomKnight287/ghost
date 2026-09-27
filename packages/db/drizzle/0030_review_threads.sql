ALTER TABLE "pull_request_review" ALTER COLUMN "state" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ALTER COLUMN "reviewId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD COLUMN "dismissedById" text;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD COLUMN "dismissalMessage" text;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD COLUMN "submittedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD COLUMN "pullRequestId" text;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD COLUMN "inReplyToId" text;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD COLUMN "authorId" text;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD COLUMN "commitSha" text;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD COLUMN "updatedAt" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
UPDATE "pull_request_review" SET "submittedAt" = "createdAt";--> statement-breakpoint
UPDATE "pull_request_review_comment" SET "pullRequestId" = "pull_request_review"."pullRequestId", "authorId" = "pull_request_review"."authorId", "commitSha" = "pull_request_review"."commitSha" FROM "pull_request_review" WHERE "pull_request_review"."id" = "pull_request_review_comment"."reviewId";--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ALTER COLUMN "pullRequestId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ALTER COLUMN "authorId" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ALTER COLUMN "commitSha" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_dismissedById_user_id_fk" FOREIGN KEY ("dismissedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD CONSTRAINT "pull_request_review_comment_pullRequestId_pull_request_id_fk" FOREIGN KEY ("pullRequestId") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD CONSTRAINT "pull_request_review_comment_inReplyToId_pull_request_review_comment_id_fk" FOREIGN KEY ("inReplyToId") REFERENCES "public"."pull_request_review_comment"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD CONSTRAINT "pull_request_review_comment_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_review_pending_idx" ON "pull_request_review" USING btree ("pullRequestId","authorId") WHERE "pull_request_review"."submittedAt" is null;--> statement-breakpoint
CREATE INDEX "pull_request_review_comment_reply_idx" ON "pull_request_review_comment" USING btree ("inReplyToId");--> statement-breakpoint
CREATE INDEX "pull_request_review_comment_pull_idx" ON "pull_request_review_comment" USING btree ("pullRequestId");