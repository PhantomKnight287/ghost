ALTER TABLE "pull_request" DROP CONSTRAINT "pull_request_headRepositoryId_repository_id_fk";
--> statement-breakpoint
ALTER TABLE "pull_request" ALTER COLUMN "headRepositoryId" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "pull_request" ADD CONSTRAINT "pull_request_headRepositoryId_repository_id_fk" FOREIGN KEY ("headRepositoryId") REFERENCES "public"."repository"("id") ON DELETE set null ON UPDATE no action;