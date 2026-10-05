CREATE TABLE "repository_log_entry" (
	"repository_id" text NOT NULL,
	"ulid" text NOT NULL,
	"size" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repository_log_entry_repository_id_ulid_pk" PRIMARY KEY("repository_id","ulid")
);
--> statement-breakpoint
CREATE TABLE "storage_limit" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"organization_id" text,
	"repository_bytes" bigint,
	"fork_bytes" bigint,
	"lfs_bytes" bigint,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "storage_limit_userId_unique" UNIQUE("user_id"),
	CONSTRAINT "storage_limit_organizationId_unique" UNIQUE("organization_id"),
	CONSTRAINT "storage_limit_owner" CHECK (num_nonnulls(user_id, organization_id) = 1)
);
--> statement-breakpoint
ALTER TABLE "repository_log_entry" ADD CONSTRAINT "repository_log_entry_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_limit" ADD CONSTRAINT "storage_limit_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "storage_limit" ADD CONSTRAINT "storage_limit_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;