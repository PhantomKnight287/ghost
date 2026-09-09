CREATE TABLE "pull_request_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"pullRequestId" text NOT NULL,
	"authorId" text NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pull_request_comment_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "pull_request_comment" ADD CONSTRAINT "pull_request_comment_pullRequestId_pull_request_id_fk" FOREIGN KEY ("pullRequestId") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_comment" ADD CONSTRAINT "pull_request_comment_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_request_comment_pull_request_idx" ON "pull_request_comment" USING btree ("pullRequestId","createdAt");