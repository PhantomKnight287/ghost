CREATE TABLE "repository" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"organizationId" text,
	"ownerId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "repository_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_ownerId_user_id_fk" FOREIGN KEY ("ownerId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_org_slug_idx" ON "repository" USING btree ("organizationId","slug") WHERE "repository"."organizationId" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_owner_slug_idx" ON "repository" USING btree ("ownerId","slug") WHERE "repository"."organizationId" is null;