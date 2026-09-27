CREATE TABLE "release" (
	"id" text PRIMARY KEY NOT NULL,
	"repositoryId" text NOT NULL,
	"tagName" text NOT NULL,
	"name" text,
	"body" text,
	"isDraft" boolean DEFAULT false NOT NULL,
	"isPrerelease" boolean DEFAULT false NOT NULL,
	"authorId" text,
	"publishedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_authorId_user_id_fk" FOREIGN KEY ("authorId") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "release_repository_tag_idx" ON "release" USING btree ("repositoryId","tagName");--> statement-breakpoint
CREATE INDEX "release_repository_created_idx" ON "release" USING btree ("repositoryId","createdAt");