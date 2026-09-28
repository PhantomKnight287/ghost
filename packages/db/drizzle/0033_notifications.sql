CREATE TYPE "public"."notification_reason" AS ENUM('assigned', 'mentioned', 'team_mentioned', 'author', 'subscribed', 'watching');--> statement-breakpoint
CREATE TYPE "public"."repository_watch_level" AS ENUM('all', 'ignore');--> statement-breakpoint
CREATE TABLE "issue_subscription" (
	"user_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"subscribed" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "issue_subscription_user_id_issue_id_pk" PRIMARY KEY("user_id","issue_id")
);
--> statement-breakpoint
CREATE TABLE "notification" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"issue_id" text NOT NULL,
	"reason" "notification_reason" NOT NULL,
	"event_type" text NOT NULL,
	"actor_id" text,
	"unread" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_event" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"repository_id" text NOT NULL,
	"actor_id" text,
	"payload" jsonb NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "repository_watch" (
	"user_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"level" "repository_watch_level" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_watch_user_id_repository_id_pk" PRIMARY KEY("user_id","repository_id")
);
--> statement-breakpoint
ALTER TABLE "issue_subscription" ADD CONSTRAINT "issue_subscription_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_subscription" ADD CONSTRAINT "issue_subscription_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_issue_id_issue_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_event" ADD CONSTRAINT "outbox_event_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_watch" ADD CONSTRAINT "repository_watch_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_watch" ADD CONSTRAINT "repository_watch_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "issue_subscription_issue_idx" ON "issue_subscription" USING btree ("issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "notification_user_issue_idx" ON "notification" USING btree ("user_id","issue_id");--> statement-breakpoint
CREATE INDEX "notification_user_updated_idx" ON "notification" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "outbox_event_pending_idx" ON "outbox_event" USING btree ("created_at","id") WHERE "outbox_event"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "repository_watch_repository_idx" ON "repository_watch" USING btree ("repository_id");