ALTER TABLE "release" ADD COLUMN "source_commit_sha" text;--> statement-breakpoint
ALTER TABLE "release" ADD COLUMN "zipball_size" bigint;--> statement-breakpoint
ALTER TABLE "release" ADD COLUMN "tarball_size" bigint;--> statement-breakpoint
ALTER TABLE "release" ADD COLUMN "zipball_download_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "release" ADD COLUMN "tarball_download_count" integer DEFAULT 0 NOT NULL;