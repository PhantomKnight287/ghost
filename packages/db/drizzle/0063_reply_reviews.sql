-- Custom SQL migration file, put your code below! --
-- Every reply becomes a comment-only review of its own, submitted when the reply was written, as replies made from now on are.
WITH "reply" AS (
	SELECT "id", "pull_request_id", "author_id", "commit_sha", "created_at", 'prr_' || substr(md5(random()::text || "id"), 1, 24) AS "review_id"
	FROM "pull_request_review_comment"
	WHERE "review_id" IS NULL
), "inserted" AS (
	INSERT INTO "pull_request_review" ("id", "pull_request_id", "author_id", "state", "commit_sha", "created_at", "submitted_at")
	SELECT "review_id", "pull_request_id", "author_id", 'commented', "commit_sha", "created_at", "created_at" FROM "reply"
)
UPDATE "pull_request_review_comment" SET "review_id" = "reply"."review_id"
FROM "reply"
WHERE "pull_request_review_comment"."id" = "reply"."id";
