CREATE TABLE "pull_request_ref_write_pending" (
	"id" text PRIMARY KEY NOT NULL,
	"pull_request_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pull_request_ref_write_pending" ADD CONSTRAINT "pull_request_ref_write_pending_pull_request_id_pull_request_id_fk" FOREIGN KEY ("pull_request_id") REFERENCES "public"."pull_request"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pull_request_ref_write_pending_pull_idx" ON "pull_request_ref_write_pending" USING btree ("pull_request_id");