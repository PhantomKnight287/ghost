CREATE TABLE "stars" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text NOT NULL,
	"repositoryId" text NOT NULL,
	"createdAt" timestamp DEFAULT now() NOT NULL,
	"updatedAt" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "stars_id_unique" UNIQUE("id")
);
--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_userId_user_id_fk" FOREIGN KEY ("userId") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stars" ADD CONSTRAINT "stars_repositoryId_repository_id_fk" FOREIGN KEY ("repositoryId") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "stars_userId_repositoryId_index" ON "stars" USING btree ("userId","repositoryId");