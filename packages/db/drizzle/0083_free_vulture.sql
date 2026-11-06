CREATE TYPE "public"."check_annotation_level" AS ENUM('notice', 'warning', 'failure');--> statement-breakpoint
CREATE TYPE "public"."check_conclusion" AS ENUM('success', 'failure', 'neutral', 'cancelled', 'skipped', 'timed_out', 'action_required');--> statement-breakpoint
CREATE TYPE "public"."check_status" AS ENUM('queued', 'in_progress', 'completed');--> statement-breakpoint
CREATE TABLE "check_annotation" (
	"id" text PRIMARY KEY NOT NULL,
	"numeric_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "check_annotation_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"run_id" text NOT NULL,
	"path" text NOT NULL,
	"start_line" integer NOT NULL,
	"end_line" integer NOT NULL,
	"start_column" integer,
	"end_column" integer,
	"annotation_level" "check_annotation_level" NOT NULL,
	"message" text NOT NULL,
	"title" text,
	"raw_details" text,
	CONSTRAINT "check_annotation_numericId_unique" UNIQUE("numeric_id")
);
--> statement-breakpoint
CREATE TABLE "check_run" (
	"id" text PRIMARY KEY NOT NULL,
	"numeric_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "check_run_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"suite_id" text NOT NULL,
	"repository_id" text NOT NULL,
	"head_sha" text NOT NULL,
	"name" text NOT NULL,
	"status" "check_status" DEFAULT 'queued' NOT NULL,
	"conclusion" "check_conclusion",
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"completed_once" boolean DEFAULT false NOT NULL,
	"external_id" text,
	"details_url" text,
	"output_title" text,
	"output_summary" text,
	"output_text" text,
	"actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_run_numericId_unique" UNIQUE("numeric_id")
);
--> statement-breakpoint
CREATE TABLE "check_suite" (
	"id" text PRIMARY KEY NOT NULL,
	"numeric_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "check_suite_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repository_id" text NOT NULL,
	"head_sha" text NOT NULL,
	"head_branch" text,
	"app_id" text NOT NULL,
	"installation_id" text,
	"status" "check_status" DEFAULT 'queued' NOT NULL,
	"conclusion" "check_conclusion",
	"before" text,
	"after" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "check_suite_numericId_unique" UNIQUE("numeric_id"),
	CONSTRAINT "check_suite_repositoryId_headSha_appId_unique" UNIQUE("repository_id","head_sha","app_id")
);
--> statement-breakpoint
ALTER TABLE "check_annotation" ADD CONSTRAINT "check_annotation_run_id_check_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."check_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_run" ADD CONSTRAINT "check_run_suite_id_check_suite_id_fk" FOREIGN KEY ("suite_id") REFERENCES "public"."check_suite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_run" ADD CONSTRAINT "check_run_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_suite" ADD CONSTRAINT "check_suite_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_suite" ADD CONSTRAINT "check_suite_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "check_suite" ADD CONSTRAINT "check_suite_installation_id_app_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."app_installation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "check_annotation_run_idx" ON "check_annotation" USING btree ("run_id","numeric_id");--> statement-breakpoint
CREATE INDEX "check_run_lookup_idx" ON "check_run" USING btree ("repository_id","head_sha","name","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "check_run_suite_idx" ON "check_run" USING btree ("suite_id");