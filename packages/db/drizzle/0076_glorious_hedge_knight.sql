DROP INDEX "label_repo_name_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "label_repo_name_idx" ON "label" USING btree ("repository_id",lower("name"));