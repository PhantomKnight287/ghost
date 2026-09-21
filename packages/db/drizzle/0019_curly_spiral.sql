CREATE TABLE "user_gpg_key" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"key_id" text NOT NULL,
	"fingerprint" text NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_gpg_key_key_id_unique" UNIQUE("key_id"),
	CONSTRAINT "user_gpg_key_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
ALTER TABLE "user_gpg_key" ADD CONSTRAINT "user_gpg_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_gpg_key_user_id_idx" ON "user_gpg_key" USING btree ("user_id");