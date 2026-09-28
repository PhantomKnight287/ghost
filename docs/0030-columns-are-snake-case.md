# 0030 — Columns are snake_case in the database, camelCase in the schema

**Status:** adopted

## Decision

The drizzle client and drizzle-kit both run with `casing: "snake_case"`, so a schema field `repositoryId` is the column `repository_id`. Schema files leave column names out unless a column's name must differ from its field.

Raw SQL never spells a column by hand. It interpolates the column, `${schema.issue.number}`, and an upsert reads the proposed row through `excluded(column)` from `utils`.

Migration 0034 renamed every existing camelCase column. Drizzle generated it; each rename was confirmed as a rename, never a drop and a create, and it moves no data.

## Why

Querying the database directly is easier without quoting every column.
