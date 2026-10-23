CREATE TYPE "public"."rule_evaluation_result" AS ENUM('pass', 'fail');--> statement-breakpoint
CREATE TYPE "public"."rule_suite_result" AS ENUM('pass', 'fail', 'bypass');--> statement-breakpoint
CREATE TYPE "public"."rule_suite_write" AS ENUM('push', 'pull_request_merge');--> statement-breakpoint
CREATE TABLE "rule_evaluation" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_suite_id" text NOT NULL,
	"position" integer NOT NULL,
	"ruleset_id" text,
	"ruleset_name" text NOT NULL,
	"enforcement" "ruleset_enforcement" NOT NULL,
	"rule_type" "ruleset_rule_type" NOT NULL,
	"result" "rule_evaluation_result" NOT NULL,
	"requirements" text[] DEFAULT '{}' NOT NULL,
	"details" text
);
--> statement-breakpoint
CREATE TABLE "rule_suite" (
	"id" text PRIMARY KEY NOT NULL,
	"numeric_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "rule_suite_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"repository_id" text NOT NULL,
	"actor_id" text,
	"actor_name" text,
	"ref" text NOT NULL,
	"before_sha" text NOT NULL,
	"after_sha" text NOT NULL,
	"write" "rule_suite_write" NOT NULL,
	"pull_request_id" text,
	"result" "rule_suite_result" NOT NULL,
	"evaluation_result" "rule_suite_result",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rule_suite_numericId_unique" UNIQUE("numeric_id")
);
--> statement-breakpoint
ALTER TABLE "rule_evaluation" ADD CONSTRAINT "rule_evaluation_rule_suite_id_rule_suite_id_fk" FOREIGN KEY ("rule_suite_id") REFERENCES "public"."rule_suite"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_evaluation" ADD CONSTRAINT "rule_evaluation_ruleset_id_ruleset_id_fk" FOREIGN KEY ("ruleset_id") REFERENCES "public"."ruleset"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_suite" ADD CONSTRAINT "rule_suite_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_suite" ADD CONSTRAINT "rule_suite_actor_id_user_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rule_suite" ADD CONSTRAINT "rule_suite_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rule_evaluation_rule_suite_id_position_index" ON "rule_evaluation" USING btree ("rule_suite_id","position");--> statement-breakpoint
CREATE INDEX "rule_evaluation_ruleset_id_index" ON "rule_evaluation" USING btree ("ruleset_id");--> statement-breakpoint
CREATE INDEX "rule_suite_repository_id_created_at_id_index" ON "rule_suite" USING btree ("repository_id","created_at","id");