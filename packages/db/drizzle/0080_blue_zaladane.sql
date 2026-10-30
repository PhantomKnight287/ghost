CREATE TABLE "app_client_secret" (
	"id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"last_eight" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_client_secret_secretHash_unique" UNIQUE("secret_hash")
);
--> statement-breakpoint
CREATE TABLE "app_user_token" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"app_id" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "app_user_token_tokenHash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
ALTER TABLE "app" ADD COLUMN "oauth_client_id" text;--> statement-breakpoint
ALTER TABLE "app" ADD COLUMN "request_oauth_on_install" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "commit_status" ADD COLUMN "via_app_id" text;--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "via_app_id" text;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD COLUMN "via_app_id" text;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD COLUMN "via_app_id" text;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD COLUMN "via_app_id" text;--> statement-breakpoint
ALTER TABLE "app_client_secret" ADD CONSTRAINT "app_client_secret_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_token" ADD CONSTRAINT "app_user_token_app_id_app_id_fk" FOREIGN KEY ("app_id") REFERENCES "public"."app"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app_user_token" ADD CONSTRAINT "app_user_token_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "app_client_secret_app_id_idx" ON "app_client_secret" USING btree ("app_id");--> statement-breakpoint
CREATE INDEX "app_user_token_app_user_idx" ON "app_user_token" USING btree ("app_id","user_id");--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_oauth_client_id_oauth_client_client_id_fk" FOREIGN KEY ("oauth_client_id") REFERENCES "public"."oauth_client"("client_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commit_status" ADD CONSTRAINT "commit_status_via_app_id_app_id_fk" FOREIGN KEY ("via_app_id") REFERENCES "public"."app"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_via_app_id_app_id_fk" FOREIGN KEY ("via_app_id") REFERENCES "public"."app"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_via_app_id_app_id_fk" FOREIGN KEY ("via_app_id") REFERENCES "public"."app"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review" ADD CONSTRAINT "pull_request_review_via_app_id_app_id_fk" FOREIGN KEY ("via_app_id") REFERENCES "public"."app"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pull_request_review_comment" ADD CONSTRAINT "pull_request_review_comment_via_app_id_app_id_fk" FOREIGN KEY ("via_app_id") REFERENCES "public"."app"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app" ADD CONSTRAINT "app_oauthClientId_unique" UNIQUE("oauth_client_id");