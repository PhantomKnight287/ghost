CREATE TABLE "lfs_lock" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"path" text NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lfs_object" (
	"repository_id" text NOT NULL,
	"oid" text NOT NULL,
	"size" bigint NOT NULL,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lfs_object_repository_id_oid_pk" PRIMARY KEY("repository_id","oid")
);
--> statement-breakpoint
ALTER TABLE "lfs_lock" ADD CONSTRAINT "lfs_lock_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lfs_lock" ADD CONSTRAINT "lfs_lock_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lfs_object" ADD CONSTRAINT "lfs_object_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lfs_lock_repository_path_idx" ON "lfs_lock" USING btree ("repository_id","path");