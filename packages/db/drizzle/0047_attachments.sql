CREATE TABLE "attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"size" bigint NOT NULL,
	"uploader_id" text,
	"uploaded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attachment" ADD CONSTRAINT "attachment_uploader_id_user_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachment_repository_idx" ON "attachment" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "attachment_created_idx" ON "attachment" USING btree ("created_at");