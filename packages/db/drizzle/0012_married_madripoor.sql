CREATE TYPE "public"."pull_request_state" AS ENUM('open', 'closed', 'merged');--> statement-breakpoint
CREATE TABLE "pull_request" (
	"id" text PRIMARY KEY NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"state" "pull_request_state" DEFAULT 'open' NOT NULL,
	"baseRepositoryId" text NOT NULL,
	"baseRef" text NOT NULL,
	"headRepositoryId" text NOT NULL,
	"headRef" text NOT NULL,
	"headSha" text NOT NULL,
	"mergeCommitSha" text,
	"authorId" text NOT NULL,
	"closedAt" timestamp,
	"mergedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "pull_request_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_baseRepositoryId_repository_id_fk" FOREIGN KEY ("baseRepositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_headRepositoryId_repository_id_fk" FOREIGN KEY ("headRepositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_base_number_idx" ON "pull_request" USING btree ("baseRepositoryId","number");--> statement-breakpoint
CREATE UNIQUE INDEX "pull_request_open_branch_idx" ON "pull_request" USING btree ("baseRepositoryId","baseRef","headRepositoryId","headRef") WHERE "pull_request"."state" = 'open';--> statement-breakpoint
CREATE INDEX "pull_request_head_idx" ON "pull_request" USING btree ("headRepositoryId");--> statement-breakpoint
CREATE INDEX "pull_request_base_state_idx" ON "pull_request" USING btree ("baseRepositoryId","state");