CREATE TABLE "repository_contribution" (
	"repositoryId" text NOT NULL,
	"authorEmail" text NOT NULL,
	"day" date NOT NULL,
	"authorName" text NOT NULL,
	"commits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "repository_contribution_repositoryId_authorEmail_day_pk" PRIMARY KEY("repositoryId","authorEmail","day")
);
--> statement-breakpoint
CREATE TABLE "repository_contribution_index" (
	"repositoryId" text NOT NULL,
	"indexedCommitSha" text NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_contribution_index_repositoryId_pk" PRIMARY KEY("repositoryId")
);
--> statement-breakpoint
ALTER TABLE "repository_contribution" ADD CONSTRAINT "repository_contribution_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_contribution_index" ADD CONSTRAINT "repository_contribution_index_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;