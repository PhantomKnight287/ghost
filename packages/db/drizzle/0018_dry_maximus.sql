CREATE TABLE "user_email" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"email" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"token" text,
	"token_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_email_unique" UNIQUE("email"),
	CONSTRAINT "user_email_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "user_email" ADD CONSTRAINT "user_email_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_email_user_id_idx" ON "user_email" USING btree ("user_id");