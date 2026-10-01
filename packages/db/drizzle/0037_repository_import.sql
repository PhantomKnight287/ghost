CREATE TYPE "public"."repository_import_status" AS ENUM('pending', 'running', 'succeeded', 'failed');--> statement-breakpoint
CREATE TABLE "repository_import" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"requested_by_id" text NOT NULL,
	"source" text NOT NULL,
	"status" "repository_import_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_until" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"api_key_id" text,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_import_repositoryId_unique" UNIQUE("repository_id")
);
--> statement-breakpoint
ALTER TABLE "repository_import" ADD CONSTRAINT "repository_import_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_import" ADD CONSTRAINT "repository_import_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_import_active_idx" ON "repository_import" USING btree ("next_attempt_at") WHERE "repository_import"."status" in ('pending', 'running');