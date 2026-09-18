CREATE TABLE "repository_contribution" (
	"repository_id" text NOT NULL,
	"author_email" text NOT NULL,
	"day" date NOT NULL,
	"author_name" text NOT NULL,
	"author_id" text,
	"commits" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "repository_contribution_repository_id_author_email_day_pk" PRIMARY KEY("repository_id","author_email","day")
);
--> statement-breakpoint
CREATE TABLE "repository_contribution_index" (
	"repository_id" text NOT NULL,
	"indexed_commit_sha" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_contribution_index_repository_id_pk" PRIMARY KEY("repository_id")
);
--> statement-breakpoint
ALTER TABLE "repository_contribution" ADD CONSTRAINT "repository_contribution_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_contribution" ADD CONSTRAINT "repository_contribution_author_id_user_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repository_contribution_index" ADD CONSTRAINT "repository_contribution_index_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;