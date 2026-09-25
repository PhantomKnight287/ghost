CREATE TYPE "public"."issue_reference_source" AS ENUM('issue', 'comment', 'commit');--> statement-breakpoint
ALTER TYPE "public"."issue_event_type" ADD VALUE 'merged';--> statement-breakpoint
CREATE TABLE "issue_reference" (
	"id" text PRIMARY KEY NOT NULL,
	"sourceType" "issue_reference_source" NOT NULL,
	"sourceId" text NOT NULL,
	"sourceRepositoryId" text NOT NULL,
	"sourceIssueId" text,
	"targetIssueId" text NOT NULL,
	"closing" boolean DEFAULT false NOT NULL,
	"actorId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_reference_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "isPullRequest" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request" ADD COLUMN "issueId" text;--> statement-breakpoint
UPDATE "pull_request" SET "issueId" = 'issue_' || replace(gen_random_uuid()::text, '-', '');--> statement-breakpoint
-- Issues and pull requests counted separately until now; a request whose number an issue already holds moves past the repository's highest number, oldest first.
INSERT INTO "issue" ("id", "repositoryId", "number", "title", "body", "state", "isPullRequest", "authorId", "closedAt", "createdAt", "updatedAt")
SELECT
	pr."issueId",
	pr."baseRepositoryId",
	CASE WHEN taken.number IS NULL THEN pr."number" ELSE
		greatest(
			coalesce((SELECT max(i."number") FROM "issue" i WHERE i."repositoryId" = pr."baseRepositoryId"), 0),
			(SELECT max(p."number") FROM "pull_request" p WHERE p."baseRepositoryId" = pr."baseRepositoryId")
		) + row_number() OVER (PARTITION BY pr."baseRepositoryId", taken.number IS NULL ORDER BY pr."createdAt", pr."id")
	END,
	pr."title",
	pr."body",
	CASE WHEN pr."state" = 'open' THEN 'open'::issue_state ELSE 'closed'::issue_state END,
	true,
	pr."authorId",
	pr."closedAt",
	pr."createdAt",
	pr."updatedAt"
FROM "pull_request" pr
LEFT JOIN "issue" taken ON taken."repositoryId" = pr."baseRepositoryId" AND taken."number" = pr."number";--> statement-breakpoint
INSERT INTO "issue_event" ("id", "issueId", "actorId", "type", "createdAt")
SELECT 'iev_' || replace(gen_random_uuid()::text, '-', ''), pr."issueId", pr."authorId", 'opened', pr."createdAt"
FROM "pull_request" pr;--> statement-breakpoint
INSERT INTO "issue_comment" ("id", "issueId", "authorId", "body", "createdAt", "updatedAt")
SELECT c."id", pr."issueId", c."authorId", c."body", c."createdAt", c."updatedAt"
FROM "pull_request_comment" c
JOIN "pull_request" pr ON pr."id" = c."pullRequestId";--> statement-breakpoint
UPDATE "issue" SET "commentCount" = counted.total
FROM (SELECT "issueId", count(*)::int AS total FROM "issue_comment" GROUP BY "issueId") counted
WHERE counted."issueId" = "issue"."id" AND "issue"."isPullRequest";--> statement-breakpoint
ALTER TABLE "pull_request" ALTER COLUMN "issueId" SET NOT NULL;--> statement-breakpoint
DROP TABLE "pull_request_comment" CASCADE;--> statement-breakpoint
ALTER TABLE "pull_request" DROP CONSTRAINT "pull_request_authorId_user_id_fk";
--> statement-breakpoint
DROP INDEX "pull_request_base_number_idx";--> statement-breakpoint
DROP INDEX "issue_repo_state_idx";--> statement-breakpoint
ALTER TABLE "issue_event" ADD COLUMN "sourceIssueId" text;--> statement-breakpoint
ALTER TABLE "issue_event" ADD COLUMN "commitSha" text;--> statement-breakpoint
ALTER TABLE "issue_reference" ADD CONSTRAINT "issue_reference_sourceRepositoryId_repository_id_fk" FOREIGN KEY ("sourceRepositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference" ADD CONSTRAINT "issue_reference_sourceIssueId_issue_id_fk" FOREIGN KEY ("sourceIssueId") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference" ADD CONSTRAINT "issue_reference_targetIssueId_issue_id_fk" FOREIGN KEY ("targetIssueId") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_reference" ADD CONSTRAINT "issue_reference_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_reference_source_target_idx" ON "issue_reference" USING btree ("sourceType","sourceId","targetIssueId");--> statement-breakpoint
CREATE INDEX "issue_reference_target_idx" ON "issue_reference" USING btree ("targetIssueId","createdAt");--> statement-breakpoint
CREATE INDEX "issue_reference_source_issue_idx" ON "issue_reference" USING btree ("sourceIssueId");--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_issueId_issue_id_fk" FOREIGN KEY ("issueId") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_event" ADD CONSTRAINT "issue_event_sourceIssueId_issue_id_fk" FOREIGN KEY ("sourceIssueId") REFERENCES "public"."issue"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_repo_kind_state_idx" ON "issue" USING btree ("repositoryId","isPullRequest","state");--> statement-breakpoint
ALTER TABLE "pull_request" DROP COLUMN "number";--> statement-breakpoint
ALTER TABLE "pull_request" DROP COLUMN "title";--> statement-breakpoint
ALTER TABLE "pull_request" DROP COLUMN "body";--> statement-breakpoint
ALTER TABLE "pull_request" DROP COLUMN "authorId";--> statement-breakpoint
ALTER TABLE "pull_request" DROP COLUMN "closedAt";--> statement-breakpoint
ALTER TABLE "pull_request" DROP COLUMN "createdAt";--> statement-breakpoint
ALTER TABLE "pull_request" DROP COLUMN "updatedAt";--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_issueId_unique" UNIQUE("issueId");