CREATE TYPE "public"."organization_oauth_app_state" AS ENUM('requested', 'approved', 'denied');--> statement-breakpoint
CREATE TABLE "organization_oauth_app" (
	"organization_id" text NOT NULL,
	"client_id" text NOT NULL,
	"state" "organization_oauth_app_state" NOT NULL,
	"requested_by_id" text,
	"decided_by_id" text,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	CONSTRAINT "organization_oauth_app_organization_id_client_id_pk" PRIMARY KEY("organization_id","client_id")
);
--> statement-breakpoint
ALTER TABLE "organization_settings" ADD COLUMN "oauth_app_restrictions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization_oauth_app" ADD CONSTRAINT "organization_oauth_app_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_oauth_app" ADD CONSTRAINT "organization_oauth_app_client_id_oauth_client_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_oauth_app" ADD CONSTRAINT "organization_oauth_app_requested_by_id_user_id_fk" FOREIGN KEY ("requested_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_oauth_app" ADD CONSTRAINT "organization_oauth_app_decided_by_id_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;