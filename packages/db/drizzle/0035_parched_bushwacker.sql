CREATE TYPE "public"."delivery_job_kind" AS ENUM('email', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."delivery_job_status" AS ENUM('pending', 'succeeded', 'dead');--> statement-breakpoint
CREATE TABLE "delivery_attempt" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"duration_ms" integer NOT NULL,
	"status_code" integer,
	"error" text,
	"request_headers" jsonb NOT NULL,
	"response_body" text
);
--> statement-breakpoint
CREATE TABLE "delivery_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "delivery_job_kind" NOT NULL,
	"idempotency_key" text NOT NULL,
	"payload" jsonb NOT NULL,
	"endpoint_id" text,
	"status" "delivery_job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone DEFAULT now() NOT NULL,
	"claim_token" uuid DEFAULT gen_random_uuid() NOT NULL,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_job_idempotencyKey_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoint" (
	"id" text PRIMARY KEY NOT NULL,
	"repository_id" text,
	"organization_id" text,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"events" text[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"disabled_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_endpoint_secret_unique" UNIQUE("secret"),
	CONSTRAINT "webhook_endpoint_owner" CHECK (num_nonnulls(repository_id, organization_id) = 1)
);
--> statement-breakpoint
ALTER TABLE "delivery_attempt" ADD CONSTRAINT "delivery_attempt_job_id_delivery_job_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."delivery_job"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_job" ADD CONSTRAINT "delivery_job_endpoint_id_webhook_endpoint_id_fk" FOREIGN KEY ("endpoint_id") REFERENCES "public"."webhook_endpoint"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_repository_id_repository_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."repository"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "delivery_attempt_job_idx" ON "delivery_attempt" USING btree ("job_id","started_at");--> statement-breakpoint
CREATE INDEX "delivery_job_pending_idx" ON "delivery_job" USING btree ("next_attempt_at") WHERE "delivery_job"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "webhook_endpoint_repository_idx" ON "webhook_endpoint" USING btree ("repository_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_organization_idx" ON "webhook_endpoint" USING btree ("organization_id");