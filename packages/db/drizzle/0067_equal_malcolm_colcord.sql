CREATE TYPE "public"."ruleset_bypass_actor_type" AS ENUM('RepositoryRole', 'Team', 'OrganizationAdmin');--> statement-breakpoint
CREATE TYPE "public"."ruleset_bypass_mode" AS ENUM('always', 'pull_request');--> statement-breakpoint
CREATE TYPE "public"."ruleset_enforcement" AS ENUM('active', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."ruleset_rule_type" AS ENUM('creation', 'update', 'deletion', 'non_fast_forward', 'required_linear_history');--> statement-breakpoint
CREATE TYPE "public"."ruleset_target" AS ENUM('branch', 'tag');--> statement-breakpoint
CREATE TABLE "ruleset" (
	"id" text PRIMARY KEY NOT NULL,
	"numeric_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "ruleset_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repository_id" text NOT NULL,
	"name" text NOT NULL,
	"target" "ruleset_target" NOT NULL,
	"enforcement" "ruleset_enforcement" DEFAULT 'active' NOT NULL,
	"include" text[] DEFAULT '{}' NOT NULL,
	"exclude" text[] DEFAULT '{}' NOT NULL,
	"created_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ruleset_numericId_unique" UNIQUE("numeric_id"),
	CONSTRAINT "ruleset_repositoryId_name_unique" UNIQUE("repository_id","name")
);
--> statement-breakpoint
CREATE TABLE "ruleset_bypass_actor" (
	"ruleset_id" text NOT NULL,
	"actor_type" "ruleset_bypass_actor_type" NOT NULL,
	"role" "repository_role",
	"team_id" text,
	"bypass_mode" "ruleset_bypass_mode" NOT NULL,
	CONSTRAINT "ruleset_bypass_actor_target" CHECK ((actor_type = 'RepositoryRole' AND role IS NOT NULL AND team_id IS NULL)
        OR (actor_type = 'Team' AND team_id IS NOT NULL AND role IS NULL)
        OR (actor_type = 'OrganizationAdmin' AND role IS NULL AND team_id IS NULL))
);
--> statement-breakpoint
CREATE TABLE "ruleset_rule" (
	"ruleset_id" text NOT NULL,
	"type" "ruleset_rule_type" NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "ruleset_rule_ruleset_id_type_pk" PRIMARY KEY("ruleset_id","type")
);
--> statement-breakpoint
ALTER TABLE "team" ADD COLUMN "numeric_id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "team_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "ruleset" ADD CONSTRAINT "ruleset_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset" ADD CONSTRAINT "ruleset_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_bypass_actor" ADD CONSTRAINT "ruleset_bypass_actor_ruleset_id_ruleset_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."ruleset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_bypass_actor" ADD CONSTRAINT "ruleset_bypass_actor_team_id_team_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_rule" ADD CONSTRAINT "ruleset_rule_ruleset_id_ruleset_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."ruleset"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ruleset_bypass_actor_role_idx" ON "ruleset_bypass_actor" USING btree ("ruleset_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "ruleset_bypass_actor_team_idx" ON "ruleset_bypass_actor" USING btree ("ruleset_id","team_id");--> statement-breakpoint
ALTER TABLE "team" ADD CONSTRAINT "team_numericId_unique" UNIQUE("numeric_id");