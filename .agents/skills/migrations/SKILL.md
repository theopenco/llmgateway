---
name: migrations
description: Generate, review, edit, apply, or resolve conflicts for Drizzle database migrations in this repo. Use when changing packages/db/src/schema.ts, running pnpm migrations or pnpm migrate, touching packages/db/migrations, reviewing migration diffs, or handling migration merge conflicts.
---

# Migrations

Use this workflow for database schema changes and migration conflicts.

## Default: use generated SQL

Assume Drizzle applies migrations cleanly and tracks which have run.
Generate, review, and commit the migration without adapting its SQL by default.

Do not add `IF NOT EXISTS`, `IF EXISTS`, existence probes, or duplicate-object
handlers for hypothetical reruns, partial application, or schema drift. The one
exception is index changes on existing tables (see Locking).
Regenerating an unmerged migration after syncing with `main` does not justify
compatibility with its earlier branch version. A speculative review warning is
not evidence that a migration ran outside the normal workflow.

## How Drizzle tracks migrations

- Each migration is a folder `packages/db/migrations/<YYYYMMDDHHMMSS>_<name>/` holding `migration.sql` and `snapshot.json`.
- The migrator records each applied folder name in `drizzle.__drizzle_migrations.name` and applies every local folder whose name is missing, regardless of timestamp. A branch migration older than migrations already on `main` still runs after merge.
- The folder name is the tracking key: never rename or delete a merged migration folder. A renamed folder runs again.
- Each `snapshot.json` lists its parents in `prevIds`. `drizzle-kit` follows that graph, and an open leaf merges into the next generated diff, so a snapshot with a wrong parent makes `pnpm migrations` emit destructive DROPs.

## Generate migrations

- Run all commands from the repository root.
- CI allows at most one new migration per PR (`scripts/check-new-migrations.sh`). For follow-up schema changes, delete and regenerate the PR’s unmerged migration instead of adding another; never delete a merged migration.
- Make schema changes in `packages/db/src/schema.ts`. Tables use `snakeCase.table`, which maps camelCase fields to snake_case columns.
- Generate the migration with `pnpm migrations --name <name>`. It also runs the commutativity check below.
- Name it after the change in snake_case, at most four words: `<table>_<column>` for an added column, `<table>` for a new table, `<index_name>` for an index, and a `drop_` or `rename_` prefix for destructive changes (`project_description`, `api_key_status_idx`, `drop_transaction_note`). Never keep Drizzle's random default name.
- If one migration mixes changes, name the destructive one; if that is unclear, split the schema change into separate migrations.
- Review the new `packages/db/migrations/<timestamp>_<name>/` folder; confirm the SQL matches the name.

## How migrations run

`runMigrations` (`packages/db/src/migrate.ts`) applies each pending migration in
its own transaction on one connection with `lock_timeout` (5s), a
`statement_timeout`, and an advisory lock that serializes runners. A lock
timeout or deadlock rolls that migration back and retries with backoff, then
fails naming the blocking sessions. `pnpm migrate` applies; `pnpm migrate
--check` is a read-only preflight. Production runs the same entry point
(`node dist/migrate.js`) as a job before rollout, with
`MIGRATIONS_REQUIRE_PREBUILT_INDEXES=true`.

## Locking

Every `ALTER TABLE` takes ACCESS EXCLUSIVE until the migration commits, and
queued app queries wait behind the request. `pnpm migrations:lint` (CI) checks
migrations created since the lint was added:

- Index changes on existing tables use `CREATE INDEX IF NOT EXISTS` / `DROP INDEX IF EXISTS`. With `MIGRATIONS_REQUIRE_PREBUILT_INDEXES=true` the deploy refuses until the index was built or dropped `CONCURRENTLY` and prints the commands; list them under "Manual steps" in the PR. Indexes on tables the migration creates are exempt; `-- migrate:allow-blocking-index` above a statement opts out for a small table.
- Flagged unless acknowledged: altering more than one existing table in one migration, `ALTER COLUMN ... TYPE`, `SET NOT NULL`, a `FOREIGN KEY` without `NOT VALID`, and `ADD COLUMN` with a volatile default. Prefer expand/contract (add, backfill in batches, then constrain in a later PR). Otherwise acknowledge with `-- migrate:reviewed <why this is safe or the manual step>` above the statement (anywhere in the file for the multi-table rule).

## Backward compatibility

Migrations run before rollout and are never reverted, so the previous release
runs on the new schema during every rollout and after any rollback. Drizzle
names every `schema.ts` column in each SELECT, RETURNING, and INSERT, so a
column the previous release still declares must still exist. Additive changes
(new tables, nullable columns, columns with a DEFAULT) are safe.

Remove a column or table in two deployed PRs:

1. Remove every use and the field from `schema.ts`, without a migration.
2. After step 1 is deployed, run `pnpm migrations --name drop_<table>_<column>`
   and put `-- migrate:contract #<step 1 PR>` above the DROP. Until it merges,
   every `pnpm migrations` run emits that DROP.

Rename by adding the new column, writing both, backfilling, switching reads,
then dropping the old one. Change a unique constraint or index by adding the new
one first and dropping the old one once no deployed `onConflict` targets it.
`pnpm migrations:lint` flags DROP TABLE/COLUMN/INDEX, RENAME, DROP CONSTRAINT
(except `*_fk`), DROP DEFAULT, and ADD COLUMN NOT NULL without DEFAULT unless
the statement carries `-- migrate:contract <reason>`. A `-- migrate:reviewed`
reason on SET NOT NULL or a type change must also cover what the previous
release writes.

## Editing generated migrations

- Do not write a migration by hand from scratch. Generate it first with `pnpm migrations --name <name>`.
- The operational exception is avoiding locks on huge tables, especially when creating indexes. Treat all history tables as large when reviewing locking behavior.
- If that requires adaptation (including `IF [NOT] EXISTS` on index changes and lint markers), edit only the generated `migration.sql`.
- Never manually edit any `snapshot.json`.
- If the TypeScript schema is wrong, fix `packages/db/src/schema.ts` and regenerate instead of patching snapshots.
- Use snake_case column names in SQL.

For a large-table index change, run `CREATE INDEX CONCURRENTLY IF NOT EXISTS`
manually, outside a transaction, before the deploy; the migration's
`IF NOT EXISTS` statement is then a no-op. Keep the generated snapshots exactly
as Drizzle wrote them.

## Syncing with main

Migration folders from different branches do not conflict in git. After merging `main`, run:

```bash
pnpm migrations:check
```

It reports non-commutative migrations: branch migrations that touch the same objects as migrations merged to `main` since the branch point. If it passes, keep the branch migration as-is. If it fails, regenerate the branch migration on top of `main`:

1. Note any locking adaptation in your branch's `migration.sql`; regeneration emits vanilla SQL and drops it.
2. Delete your branch's migration folder, then run `pnpm migrations --name <same name>`.
3. Re-apply only still-required locking adaptations. Do not carry speculative fallbacks forward.

Never resolve conflicts in migration SQL or snapshot JSON by hand.

## Validation

- Inspect `git diff packages/db/src/schema.ts packages/db/migrations/`.
- Confirm snapshot changes came from `pnpm migrations`, not manual edits.
- Run `pnpm migrations:lint` and `pnpm format` after changes.
- Run `pnpm build` after schema or migration changes.
