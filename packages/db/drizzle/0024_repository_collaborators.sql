CREATE TYPE "public"."repository_role" AS ENUM('read', 'triage', 'write', 'maintain', 'admin');--> statement-breakpoint
CREATE TABLE "repository_collaborator" (
	"id" text PRIMARY KEY NOT NULL,
	"repositoryId" text NOT NULL,
	"userId" text NOT NULL,
	"role" "repository_role" NOT NULL,
	"invitedById" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"acceptedAt" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "repository_collaborator" ADD CONSTRAINT "repository_collaborator_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_collaborator" ADD CONSTRAINT "repository_collaborator_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_collaborator" ADD CONSTRAINT "repository_collaborator_invitedById_user_id_fk" FOREIGN KEY ("invitedById") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repository_collaborator_repository_user_idx" ON "repository_collaborator" USING btree ("repositoryId","userId");--> statement-breakpoint
CREATE INDEX "repository_collaborator_user_idx" ON "repository_collaborator" USING btree ("userId");