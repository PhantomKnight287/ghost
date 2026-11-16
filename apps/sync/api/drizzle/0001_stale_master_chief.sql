CREATE TABLE "job" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"sync_id" uuid NOT NULL,
	"action" jsonb NOT NULL,
	"claim_token" uuid,
	"locked_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "job" ADD CONSTRAINT "job_sync_id_sync_id_fk" FOREIGN KEY ("sync_id") REFERENCES "public"."sync"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_sync_id_id_index" ON "job" USING btree ("sync_id","id");