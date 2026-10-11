ALTER TABLE "organization" ADD COLUMN "numeric_id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "organization_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "user" ADD COLUMN "numeric_id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "user_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "repository" ADD COLUMN "numeric_id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "repository_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "issue" ADD COLUMN "numeric_id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "issue_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "issue_comment" ADD COLUMN "numeric_id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "issue_comment_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "label" ADD COLUMN "numeric_id" bigint NOT NULL GENERATED ALWAYS AS IDENTITY (sequence name "label_numeric_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1);--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_numeric_id_unique" UNIQUE("numeric_id");--> statement-breakpoint
ALTER TABLE "user" ADD CONSTRAINT "user_numeric_id_unique" UNIQUE("numeric_id");--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_numericId_unique" UNIQUE("numeric_id");--> statement-breakpoint
ALTER TABLE "issue" ADD CONSTRAINT "issue_numericId_unique" UNIQUE("numeric_id");--> statement-breakpoint
ALTER TABLE "issue_comment" ADD CONSTRAINT "issue_comment_numericId_unique" UNIQUE("numeric_id");--> statement-breakpoint
ALTER TABLE "label" ADD CONSTRAINT "label_numericId_unique" UNIQUE("numeric_id");