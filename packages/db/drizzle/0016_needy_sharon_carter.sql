CREATE TABLE "repository_language_index" (
	"repositoryId" text NOT NULL,
	"ref" text NOT NULL,
	"indexedCommitSha" text NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_language_index_repositoryId_ref_pk" PRIMARY KEY("repositoryId","ref")
);
--> statement-breakpoint
CREATE TABLE "repository_language_stat" (
	"repositoryId" text NOT NULL,
	"ref" text NOT NULL,
	"language" text NOT NULL,
	"bytes" bigint NOT NULL,
	CONSTRAINT "repository_language_stat_repositoryId_ref_language_pk" PRIMARY KEY("repositoryId","ref","language")
);
--> statement-breakpoint
ALTER TABLE "repository_language_index" ADD CONSTRAINT "repository_language_index_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_language_stat" ADD CONSTRAINT "repository_language_stat_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;