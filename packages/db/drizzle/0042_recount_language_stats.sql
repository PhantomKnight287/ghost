-- Language stats now follow Linguist's rules (vendored, documentation and generated files, data and prose languages, .gitattributes overrides), so every stored total is stale. Without an index row the next read counts the ref from its tree again.
DELETE FROM "repository_language_stat";--> statement-breakpoint
DELETE FROM "repository_language_index";
