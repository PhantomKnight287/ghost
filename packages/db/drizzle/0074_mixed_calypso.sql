ALTER TYPE "public"."ruleset_rule_type" ADD VALUE 'required_status_checks';--> statement-breakpoint
ALTER TYPE "public"."ruleset_rule_type" ADD VALUE 'required_signatures';--> statement-breakpoint
CREATE TABLE "user_ssh_signing_key" (
	"id" text PRIMARY KEY NOT NULL,
	"numeric_id" bigint GENERATED ALWAYS AS IDENTITY (sequence name "user_ssh_signing_key_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"fingerprint" text NOT NULL,
	"public_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_ssh_signing_key_numeric_id_unique" UNIQUE("numeric_id"),
	CONSTRAINT "user_ssh_signing_key_fingerprint_unique" UNIQUE("fingerprint")
);
--> statement-breakpoint
ALTER TABLE "user_ssh_signing_key" ADD CONSTRAINT "user_ssh_signing_key_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_ssh_signing_key_user_id_idx" ON "user_ssh_signing_key" USING btree ("user_id");