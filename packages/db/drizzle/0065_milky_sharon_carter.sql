CREATE TYPE "public"."commit_status_state" AS ENUM('pending', 'success', 'failure', 'error');--> statement-breakpoint
CREATE TABLE "commit_status" (
	"id" text PRIMARY KEY NOT NULL,
	"numeric_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "commit_status_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repository_id" text NOT NULL,
	"sha" text NOT NULL,
	"state" "commit_status_state" NOT NULL,
	"context" text DEFAULT 'default' NOT NULL,
	"description" text,
	"target_url" text,
	"creator_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "commit_status_numericId_unique" UNIQUE("numeric_id")
);
--> statement-breakpoint
ALTER TABLE "commit_status" ADD CONSTRAINT "commit_status_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commit_status" ADD CONSTRAINT "commit_status_creator_id_user_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "commit_status_lookup_idx" ON "commit_status" USING btree ("repository_id","sha","context","created_at" DESC NULLS LAST);