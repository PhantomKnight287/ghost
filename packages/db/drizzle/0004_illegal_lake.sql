CREATE TYPE "public"."repository_visibility" AS ENUM('public', 'private');--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "visibility" "repository_visibility" DEFAULT 'private' NOT NULL;