CREATE TABLE "organization_pinned_repository" (
	"organizationId" text NOT NULL,
	"repositoryId" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "organization_pinned_repository_organizationId_repositoryId_pk" PRIMARY KEY("organizationId","repositoryId")
);
--> statement-breakpoint
CREATE TABLE "organization_public_member" (
	"organizationId" text NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "organization_public_member_organizationId_userId_pk" PRIMARY KEY("organizationId","userId")
);
--> statement-breakpoint
CREATE TABLE "organization_settings" (
	"organizationId" text PRIMARY KEY NOT NULL,
	"basePermission" "repository_role" DEFAULT 'read',
	"membersCanCreatePublicRepositories" boolean DEFAULT true NOT NULL,
	"membersCanCreatePrivateRepositories" boolean DEFAULT true NOT NULL,
	"allowPrivateForks" boolean DEFAULT false NOT NULL,
	"defaultBranch" text,
	"description" text,
	"website" text,
	"location" text,
	"email" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_redirect" (
	"ownerName" text NOT NULL,
	"slug" text NOT NULL,
	"repositoryId" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_transfer" (
	"repositoryId" text PRIMARY KEY NOT NULL,
	"toUserId" text,
	"toOrganizationId" text,
	"requestedById" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "team_maintainer" (
	"teamId" text NOT NULL,
	"userId" text NOT NULL,
	CONSTRAINT "team_maintainer_teamId_userId_pk" PRIMARY KEY("teamId","userId")
);
--> statement-breakpoint
ALTER TABLE "organization_pinned_repository" ADD CONSTRAINT "organization_pinned_repository_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_pinned_repository" ADD CONSTRAINT "organization_pinned_repository_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_public_member" ADD CONSTRAINT "organization_public_member_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_public_member" ADD CONSTRAINT "organization_public_member_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_settings" ADD CONSTRAINT "organization_settings_organizationId_organization_id_fk" FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_redirect" ADD CONSTRAINT "repository_redirect_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_transfer" ADD CONSTRAINT "repository_transfer_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_transfer" ADD CONSTRAINT "repository_transfer_toUserId_user_id_fk" FOREIGN KEY ("toUserId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_transfer" ADD CONSTRAINT "repository_transfer_toOrganizationId_organization_id_fk" FOREIGN KEY ("toOrganizationId") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_transfer" ADD CONSTRAINT "repository_transfer_requestedById_user_id_fk" FOREIGN KEY ("requestedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_maintainer" ADD CONSTRAINT "team_maintainer_teamId_team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_maintainer" ADD CONSTRAINT "team_maintainer_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_redirect_name_idx" ON "repository_redirect" USING btree (lower("ownerName"),"slug");--> statement-breakpoint
CREATE INDEX "repository_redirect_repository_idx" ON "repository_redirect" USING btree ("repositoryId");--> statement-breakpoint
-- Every existing organization gets its settings row, with the defaults a new one would have.
INSERT INTO "organization_settings" ("organizationId") SELECT "id" FROM "organization" ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Organization roles are now member, admin and owner; repository access moved to the base permission.
UPDATE "member" SET "role" = 'member' WHERE "role" NOT IN ('owner', 'admin');--> statement-breakpoint
UPDATE "invitation" SET "role" = 'member' WHERE "role" IS NOT NULL AND "role" NOT IN ('owner', 'admin');
