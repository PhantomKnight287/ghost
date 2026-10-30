ALTER TABLE "webhook_endpoint" DROP CONSTRAINT "webhook_endpoint_owner";--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD COLUMN "app_id" text;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_endpoint_app_idx" ON "webhook_endpoint" USING btree ("app_id");--> statement-breakpoint
ALTER TABLE "app" DROP COLUMN "webhook_url";--> statement-breakpoint
ALTER TABLE "app" DROP COLUMN "webhook_secret";--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_owner" CHECK (num_nonnulls(repository_id, organization_id, app_id) = 1);