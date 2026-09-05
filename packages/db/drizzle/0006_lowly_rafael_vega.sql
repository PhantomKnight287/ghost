CREATE TABLE "repository_path_commit" (
	"repositoryId" text NOT NULL,
	"ref" text NOT NULL,
	"path" text NOT NULL,
	"commitSha" text NOT NULL,
	"committedAt" timestamp NOT NULL,
	"subject" text NOT NULL,
	CONSTRAINT "repository_path_commit_repositoryId_ref_path_pk" PRIMARY KEY("repositoryId","ref","path")
);
--> statement-breakpoint
CREATE TABLE "repository_ref_index" (
	"repositoryId" text NOT NULL,
	"ref" text NOT NULL,
	"indexedCommitSha" text NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "repository_ref_index_repositoryId_ref_pk" PRIMARY KEY("repositoryId","ref")
);
--> statement-breakpoint
ALTER TABLE "repository_path_commit" ADD CONSTRAINT "repository_path_commit_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_ref_index" ADD CONSTRAINT "repository_ref_index_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;