CREATE TABLE "repository_team" (
	"repositoryId" text NOT NULL,
	"teamId" text NOT NULL,
	"role" "repository_role" NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_team_repositoryId_teamId_pk" PRIMARY KEY("repositoryId","teamId")
);
--> statement-breakpoint
ALTER TABLE "repository_team" ADD CONSTRAINT "repository_team_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_team" ADD CONSTRAINT "repository_team_teamId_team_id_fk" FOREIGN KEY ("teamId") REFERENCES "public"."team"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repository_team_team_idx" ON "repository_team" USING btree ("teamId");