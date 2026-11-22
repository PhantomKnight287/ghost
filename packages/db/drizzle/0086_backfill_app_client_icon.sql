-- The consent page reads a Ghost App's logo from its OAuth client, which never received it before; copy each app's logo across.
UPDATE "oauth_client" c
SET "icon" = a."logo_url"
FROM "app" a
WHERE a."oauth_client_id" = c."client_id"
  AND c."icon" IS DISTINCT FROM a."logo_url";
