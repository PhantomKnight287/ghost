CREATE TYPE "public"."release_asset_state" AS ENUM('uploading', 'uploaded');--> statement-breakpoint
CREATE TABLE "release_asset" (
	"id" text PRIMARY KEY NOT NULL,
	"releaseId" text NOT NULL,
	"repositoryId" text NOT NULL,
	"name" text NOT NULL,
	"contentType" text NOT NULL,
	"size" bigint NOT NULL,
	"state" "release_asset_state" DEFAULT 'uploading' NOT NULL,
	"downloadCount" integer DEFAULT 0 NOT NULL,
	"uploaderId" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "release_asset" ADD CONSTRAINT "release_asset_releaseId_release_id_fk" FOREIGN KEY ("releaseId") REFERENCES "public"."release"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_asset" ADD CONSTRAINT "release_asset_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release_asset" ADD CONSTRAINT "release_asset_uploaderId_user_id_fk" FOREIGN KEY ("uploaderId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "release_asset_release_name_idx" ON "release_asset" USING btree ("releaseId","name");--> statement-breakpoint
CREATE INDEX "release_asset_repository_idx" ON "release_asset" USING btree ("repositoryId");