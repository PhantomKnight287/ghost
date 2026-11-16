CREATE TABLE "activity" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sync_id" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"direction" text,
	"kind" text NOT NULL,
	"summary" text NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "delivery" (
	"side" text NOT NULL,
	"delivery_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_side_delivery_id_pk" PRIMARY KEY("side","delivery_id")
);
--> statement-breakpoint
CREATE TABLE "installation" (
	"side" text NOT NULL,
	"installation_id" bigint NOT NULL,
	"account_login" text NOT NULL,
	"status" text NOT NULL,
	CONSTRAINT "installation_side_installation_id_pk" PRIMARY KEY("side","installation_id")
);
--> statement-breakpoint
CREATE TABLE "link" (
	"sync_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"ghost_id" text NOT NULL,
	"ghost_rest_id" text,
	"github_id" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_sync_id_kind_ghost_id_pk" PRIMARY KEY("sync_id","kind","ghost_id"),
	CONSTRAINT "link_sync_id_kind_github_id_unique" UNIQUE("sync_id","kind","github_id")
);
--> statement-breakpoint
CREATE TABLE "ref" (
	"sync_id" uuid NOT NULL,
	"name" text NOT NULL,
	"base_sha" text,
	"diverged" jsonb,
	CONSTRAINT "ref_sync_id_name_pk" PRIMARY KEY("sync_id","name")
);
--> statement-breakpoint
CREATE TABLE "sync" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" text NOT NULL,
	"ghost_repo_id" text NOT NULL,
	"ghost_full_name" text NOT NULL,
	"github_repo_id" text NOT NULL,
	"github_full_name" text NOT NULL,
	"ghost_installation_id" bigint,
	"github_installation_id" bigint,
	"status" text DEFAULT 'backfilling' NOT NULL,
	"last_error" text,
	"disconnect_reason" text,
	"last_reconciled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_ghost_repo_id_unique" UNIQUE("ghost_repo_id"),
	CONSTRAINT "sync_github_repo_id_unique" UNIQUE("github_repo_id")
);
--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_sync_id_sync_id_fk" FOREIGN KEY ("sync_id") REFERENCES "public"."sync"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link" ADD CONSTRAINT "link_sync_id_sync_id_fk" FOREIGN KEY ("sync_id") REFERENCES "public"."sync"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ref" ADD CONSTRAINT "ref_sync_id_sync_id_fk" FOREIGN KEY ("sync_id") REFERENCES "public"."sync"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_sync_id_at_index" ON "activity" USING btree ("sync_id","at");