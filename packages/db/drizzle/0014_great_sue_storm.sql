CREATE TYPE "public"."issue_event_type" AS ENUM('opened', 'closed', 'reopened', 'renamed', 'edited', 'labeled', 'unlabeled', 'assigned', 'unassigned');--> statement-breakpoint
CREATE TYPE "public"."issue_state" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "issue" (
	"id" text PRIMARY KEY NOT NULL,
	"repositoryId" text NOT NULL,
	"number" integer NOT NULL,
	"title" text NOT NULL,
	"body" text,
	"state" "issue_state" DEFAULT 'open' NOT NULL,
	"authorId" text NOT NULL,
	"closedById" text,
	"commentCount" integer DEFAULT 0 NOT NULL,
	"closedAt" timestamp,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "issue_assignee" (
	"issueId" text NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "issue_assignee_issueId_userId_pk" PRIMARY KEY("issueId","userId")
);
--> statement-breakpoint
CREATE TABLE "issue_comment" (
	"id" text PRIMARY KEY NOT NULL,
	"issueId" text NOT NULL,
	"authorId" text NOT NULL,
	"body" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_comment_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "issue_event" (
	"id" text PRIMARY KEY NOT NULL,
	"issueId" text NOT NULL,
	"actorId" text,
	"type" "issue_event_type" NOT NULL,
	"labelName" text,
	"assigneeUsername" text,
	"oldTitle" text,
	"newTitle" text,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "issue_event_id_unique" UNIQUE("id")
);
--> statement-breakpoint
CREATE TABLE "issue_label" (
	"issueId" text NOT NULL,
	"labelId" text NOT NULL,
	CONSTRAINT "issue_label_issueId_labelId_pk" PRIMARY KEY("issueId","labelId")
);
--> statement-breakpoint
CREATE TABLE "label" (
	"id" text PRIMARY KEY NOT NULL,
	"repositoryId" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT 'ededed' NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "label_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_closedById_user_id_fk" FOREIGN KEY ("closedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_assignee" ADD CONSTRAINT "issue_assignee_issueId_issue_id_fk" FOREIGN KEY ("issueId") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_assignee" ADD CONSTRAINT "issue_assignee_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_issueId_issue_id_fk" FOREIGN KEY ("issueId") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_event" ADD CONSTRAINT "issue_event_issueId_issue_id_fk" FOREIGN KEY ("issueId") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_event" ADD CONSTRAINT "issue_event_actorId_user_id_fk" FOREIGN KEY ("actorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_label" ADD CONSTRAINT "issue_label_issueId_issue_id_fk" FOREIGN KEY ("issueId") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_label" ADD CONSTRAINT "issue_label_labelId_label_id_fk" FOREIGN KEY ("labelId") REFERENCES "public"."label"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "issue_repo_number_idx" ON "issue" USING btree ("repositoryId","number");--> statement-breakpoint
CREATE INDEX "issue_repo_state_idx" ON "issue" USING btree ("repositoryId","state");--> statement-breakpoint
CREATE INDEX "issue_repo_updated_idx" ON "issue" USING btree ("repositoryId","updatedAt");--> statement-breakpoint
CREATE INDEX "issue_comment_issue_idx" ON "issue_comment" USING btree ("issueId","createdAt");--> statement-breakpoint
CREATE INDEX "issue_event_issue_idx" ON "issue_event" USING btree ("issueId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "label_repo_name_idx" ON "label" USING btree ("repositoryId","name");--> statement-breakpoint
CREATE INDEX "label_repo_idx" ON "label" USING btree ("repositoryId");