ALTER TABLE "release" ADD COLUMN "numeric_id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "release_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "release_asset" ADD COLUMN "numeric_id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "release_asset_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "release_asset" ADD COLUMN "label" text;--> statement-breakpoint
ALTER TABLE "release_asset" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "release" ADD CONSTRAINT "release_numericId_unique" UNIQUE("numeric_id");--> statement-breakpoint
ALTER TABLE "release_asset" ADD CONSTRAINT "release_asset_numericId_unique" UNIQUE("numeric_id");