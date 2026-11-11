-- Numbers continue after the highest one in use. max, not count: imported repositories keep GitHub's numbers, which have gaps.
UPDATE "repository" r
SET "last_issue_number" = m."max_number"
FROM (
  SELECT "repository_id", max("number") AS "max_number"
  FROM "issue"
  GROUP BY "repository_id"
) m
WHERE m."repository_id" = r."id";
