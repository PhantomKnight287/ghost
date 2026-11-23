ALTER TABLE "link" ADD COLUMN "paired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sync" ADD COLUMN "backfill" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "sync" ADD COLUMN "refs_at_setup" jsonb;