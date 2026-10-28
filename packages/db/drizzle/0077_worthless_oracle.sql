CREATE TABLE "app" (
	"id" text PRIMARY KEY NOT NULL,
	"numeric_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "app_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"homepage_url" text NOT NULL,
	"setup_url" text,
	"logo_url" text,
	"webhook_url" text,
	"webhook_secret" text,
	"permissions" jsonb NOT NULL,
	"events" text[] NOT NULL,
	"owner_user_id" text,
	"owner_organization_id" text,
	"bot_user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "app_numericId_unique" UNIQUE("numeric_id"),
	CONSTRAINT "app_slug_unique" UNIQUE("slug"),
	CONSTRAINT "app_bot_user_id_unique" UNIQUE("bot_user_id"),
	CONSTRAINT "app_owner" CHECK ("app"."deleted_at" is not null or num_nonnulls("app"."owner_user_id", "app"."owner_organization_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "app_public_key" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"public_key" text NOT NULL,
	"fingerprint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "kind" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_owner_organization_id_organization_id_fk" FOREIGN KEY ("owner_organization_id") REFERENCES "public"."organization"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_bot_user_id_user_id_fk" FOREIGN KEY ("bot_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_public_key" ADD CONSTRAINT "app_public_key_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_owner_user_id_idx" ON "app" USING btree ("owner_user_id");--> statement-breakpoint
CREATE INDEX "app_owner_organization_id_idx" ON "app" USING btree ("owner_organization_id");--> statement-breakpoint
CREATE INDEX "app_public_key_app_id_idx" ON "app_public_key" USING btree ("app_id");