CREATE TYPE "public"."app_repository_selection" AS ENUM('all', 'selected');--> statement-breakpoint
ALTER TYPE "public"."ruleset_bypass_actor_type" ADD VALUE 'Integration';--> statement-breakpoint
CREATE TABLE "app_installation" (
	"id" text PRIMARY KEY NOT NULL,
	"numeric_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "app_installation_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"app_id" text NOT NULL,
	"account_user_id" text,
	"account_organization_id" text,
	"repository_selection" "app_repository_selection" NOT NULL,
	"permissions" jsonb NOT NULL,
	"events" text[] NOT NULL,
	"installed_by_id" text,
	"suspended_at" timestamp with time zone,
	"suspended_by_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_installation_numericId_unique" UNIQUE("numeric_id"),
	CONSTRAINT "app_installation_account" CHECK (num_nonnulls("app_installation"."account_user_id", "app_installation"."account_organization_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "app_installation_repository" (
	"installation_id" text NOT NULL,
	"repository_id" text NOT NULL,
	CONSTRAINT "app_installation_repository_installation_id_repository_id_pk" PRIMARY KEY("installation_id","repository_id")
);
--> statement-breakpoint
CREATE TABLE "app_installation_token" (
	"id" text PRIMARY KEY NOT NULL,
	"installation_id" text NOT NULL,
	"token_hash" text NOT NULL,
	"permissions" jsonb NOT NULL,
	"repository_ids" text[],
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_installation_token_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "ruleset_bypass_actor" DROP CONSTRAINT "ruleset_bypass_actor_target";--> statement-breakpoint
ALTER TABLE "commit_status" ADD COLUMN "installation_id" text;--> statement-breakpoint
ALTER TABLE "ruleset_bypass_actor" ADD COLUMN "app_id" text;--> statement-breakpoint
ALTER TABLE "app_installation" ADD CONSTRAINT "app_installation_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_installation" ADD CONSTRAINT "app_installation_account_user_id_user_id_fk" FOREIGN KEY ("account_user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_installation" ADD CONSTRAINT "app_installation_account_organization_id_organization_id_fk" FOREIGN KEY ("account_organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_installation" ADD CONSTRAINT "app_installation_installed_by_id_user_id_fk" FOREIGN KEY ("installed_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_installation" ADD CONSTRAINT "app_installation_suspended_by_id_user_id_fk" FOREIGN KEY ("suspended_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_installation_repository" ADD CONSTRAINT "app_installation_repository_installation_id_app_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."app_installation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_installation_repository" ADD CONSTRAINT "app_installation_repository_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_installation_token" ADD CONSTRAINT "app_installation_token_installation_id_app_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."app_installation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "app_installation_user_idx" ON "app_installation" USING btree ("app_id","account_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "app_installation_organization_idx" ON "app_installation" USING btree ("app_id","account_organization_id");--> statement-breakpoint
CREATE INDEX "app_installation_account_user_id_idx" ON "app_installation" USING btree ("account_user_id");--> statement-breakpoint
CREATE INDEX "app_installation_account_organization_id_idx" ON "app_installation" USING btree ("account_organization_id");--> statement-breakpoint
CREATE INDEX "app_installation_repository_repository_id_idx" ON "app_installation_repository" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "app_installation_token_installation_id_idx" ON "app_installation_token" USING btree ("installation_id");--> statement-breakpoint
CREATE INDEX "app_installation_token_expires_at_idx" ON "app_installation_token" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "commit_status" ADD CONSTRAINT "commit_status_installation_id_app_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."app_installation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ruleset_bypass_actor" ADD CONSTRAINT "ruleset_bypass_actor_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ruleset_bypass_actor_app_idx" ON "ruleset_bypass_actor" USING btree ("ruleset_id","app_id");--> statement-breakpoint
ALTER TABLE "ruleset_bypass_actor" ADD CONSTRAINT "ruleset_bypass_actor_target" CHECK ((actor_type = 'RepositoryRole' AND role IS NOT NULL AND team_id IS NULL AND app_id IS NULL)
        OR (actor_type = 'Team' AND team_id IS NOT NULL AND role IS NULL AND app_id IS NULL)
        OR (actor_type = 'OrganizationAdmin' AND role IS NULL AND team_id IS NULL AND app_id IS NULL)
        OR (actor_type::text = 'Integration' AND app_id IS NOT NULL AND role IS NULL AND team_id IS NULL));