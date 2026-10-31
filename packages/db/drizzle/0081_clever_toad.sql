ALTER TABLE "app_user_token" ADD COLUMN "installation_id" text;--> statement-breakpoint
ALTER TABLE "app_user_token" ADD COLUMN "permissions" jsonb;--> statement-breakpoint
ALTER TABLE "app_user_token" ADD COLUMN "repository_ids" text[];--> statement-breakpoint
ALTER TABLE "app_user_token" ADD CONSTRAINT "app_user_token_installation_id_app_installation_id_fk" FOREIGN KEY ("installation_id") REFERENCES "public"."app_installation"("id") ON DELETE cascade ON UPDATE no action;