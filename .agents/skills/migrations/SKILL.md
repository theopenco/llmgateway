---
name: migrations
description: Generate, review, edit, apply, or resolve conflicts for Drizzle database migrations in this repo. Use when changing packages/db/src/schema.ts, running pnpm migrations or pnpm migrate, touching packages/db/migrations, reviewing migration diffs, or handling migration merge conflicts.
---

# Migrations

Use this workflow for database schema changes and migration conflicts.

## Default: use generated SQL

Assume Drizzle applies migrations cleanly, in order, and tracks which have run.
Generate, review, and commit the migration without adapting its SQL by default.

Do not add `IF NOT EXISTS`, `IF EXISTS`, existence probes, or duplicate-object
handlers for hypothetical reruns, partial application, or schema drift.
Regenerating an unmerged migration after syncing with `main` does not justify
compatibility with its earlier branch version. A speculative review warning is
not evidence that a migration ran outside the normal workflow.

## Generate migrations

- Run all commands from the repository root.
- Make schema changes in `packages/db/src/schema.ts`.
- Generate Drizzle migration artifacts with `pnpm migrations`.
- Review the generated diff under `packages/db/migrations/`.
- Drizzle may generate:
  - `packages/db/migrations/<timestamp>_<name>.sql`
  - `packages/db/migrations/meta/<timestamp>_snapshot.json`
  - `packages/db/migrations/meta/_journal.json`

## Editing generated migrations

- Do not write a migration by hand from scratch. Generate it first with `pnpm migrations`.
- The operational exception is avoiding locks on huge tables, especially when creating indexes. Treat all history tables as large when reviewing locking behavior.
- If that requires adaptation, edit only the generated `.sql` file.
- Never manually edit any `*_snapshot.json` file.
- Never manually edit `packages/db/migrations/meta/_journal.json`.
- If the TypeScript schema is wrong, fix `packages/db/src/schema.ts` and regenerate instead of patching snapshot or journal metadata.
- Use snake_case column names in SQL because Drizzle maps camelCase TypeScript fields to snake_case database columns.

For a large-table index change, a staged rollout may require splitting the
change into two generated migrations and running `CREATE INDEX CONCURRENTLY`
manually between them, outside a transaction. Document the required order in
the SQL. Keep the generated snapshot and journal exactly as Drizzle wrote them.

## Conflict resolution

Never resolve merge conflicts in migration SQL, snapshot JSON, or journal files manually.

When merging with `main` and migration conflicts appear:

0. The reset in step 1 rewrites `packages/db/migrations/` from `origin/main`, and it acts on **tracked files only**. Two consequences:

- An untracked `.sql` (one you just generated but have not committed) survives the reset and then collides with what step 2 regenerates. It is also invisible to `git diff`, so the capture below would miss it.
- Any necessary locking adaptation of a generated `.sql` is reverted, and `pnpm migrations` emits vanilla SQL from the schema diff, so it will **not** come back on its own.

Commit (or delete) everything under the directory first, so nothing is untracked and the capture sees all of it:

```bash
git status --porcelain packages/db/migrations/   # must print nothing before continuing
git diff origin/main -- packages/db/migrations/ > /tmp/migration-adaptations.patch
```

Keep that patch as your reference and re-apply the adaptations by hand in step 3. Do not use `git stash` for this — lint-staged inserts its own backup stashes at position 0 in this repo, so a bare `git stash pop` can restore the wrong entry.

1. Reset migrations to `origin/main`:

```bash
git restore --source=origin/main packages/db/migrations/
```

2. Re-run generation from the repository root:

```bash
pnpm migrations
```

3. Review the regenerated SQL, then re-apply only still-required locking adaptations captured in step 0. Do not carry speculative fallbacks forward. Adapt only the generated `.sql` file.

## Validation

- Inspect `git diff packages/db/src/schema.ts packages/db/migrations/`.
- Confirm any snapshot JSON and journal changes came from `pnpm migrations`, not manual edits.
- Run `pnpm format` after changes.
- Run `pnpm build` after schema or migration changes.
