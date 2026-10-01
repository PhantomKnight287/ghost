-- Authors what a GitHub import brings in. It has no `account` row, so nobody can sign in as it, and `.invalid` can never receive a reset mail.
INSERT INTO "user" ("id", "name", "email", "email_verified", "username", "display_username")
VALUES ('user_ghost_importer', 'Ghost Importer', 'importer@ghost.invalid', false, 'ghost-importer', 'ghost-importer')
ON CONFLICT ("id") DO NOTHING;
