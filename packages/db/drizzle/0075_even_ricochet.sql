DROP INDEX "repository_redirect_name_idx";--> statement-breakpoint
DROP INDEX "repository_org_slug_idx";--> statement-breakpoint
DROP INDEX "repository_owner_slug_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "repository_redirect_name_idx" ON "repository_redirect" USING btree (lower("owner_name"),lower("slug"));--> statement-breakpoint
CREATE UNIQUE INDEX "repository_org_slug_idx" ON "repository" USING btree ("organization_id",lower("slug")) WHERE "repository"."organization_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_owner_slug_idx" ON "repository" USING btree ("owner_id",lower("slug")) WHERE "repository"."organization_id" is null;