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
handlers for hypothetical reruns, partial application, or schema drift.
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
- Make schema changes in `packages/db/src/schema.ts`. Tables use `snakeCase.table`, which maps camelCase fields to snake_case columns.
- Generate the migration with `pnpm migrations --name <name>`. It also runs the commutativity check below.
- Name it after the change in snake_case, at most four words: `<table>_<column>` for an added column, `<table>` for a new table, `<index_name>` for an index, and a `drop_` or `rename_` prefix for destructive changes (`project_description`, `api_key_status_idx`, `drop_transaction_note`). Never keep Drizzle's random default name.
- If one migration mixes changes, name the destructive one; if that is unclear, split the schema change into separate migrations.
- Review the new `packages/db/migrations/<timestamp>_<name>/` folder; confirm the SQL matches the name.

## Editing generated migrations

- Do not write a migration by hand from scratch. Generate it first with `pnpm migrations --name <name>`.
- The operational exception is avoiding locks on huge tables, especially when creating indexes. Treat all history tables as large when reviewing locking behavior.
- If that requires adaptation, edit only the generated `migration.sql`.
- Never manually edit any `snapshot.json`.
- If the TypeScript schema is wrong, fix `packages/db/src/schema.ts` and regenerate instead of patching snapshots.
- Use snake_case column names in SQL.

For a large-table index change, a staged rollout may require splitting the
change into two generated migrations and running `CREATE INDEX CONCURRENTLY`
manually between them, outside a transaction. Document the required order in
the SQL. Keep the generated snapshots exactly as Drizzle wrote them.

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
- Run `pnpm format` after changes.
- Run `pnpm build` after schema or migration changes.
