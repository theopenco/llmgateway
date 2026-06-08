---
name: migrations
description: Generate, review, edit, apply, or resolve conflicts for Drizzle database migrations in this repo. Use when changing packages/db/src/schema.ts, running pnpm migrations or pnpm migrate, touching packages/db/migrations, reviewing migration diffs, or handling migration merge conflicts.
---

# Migrations

Use this workflow for database schema changes and migration conflicts.

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
- If the generated migration needs adaptation, edit only the generated `.sql` file.
- Never manually edit any `*_snapshot.json` file.
- Never manually edit `packages/db/migrations/meta/_journal.json`.
- If the TypeScript schema is wrong, fix `packages/db/src/schema.ts` and regenerate instead of patching snapshot or journal metadata.
- Use snake_case column names in SQL because Drizzle maps camelCase TypeScript fields to snake_case database columns.

Appropriate `.sql`-only edits include adding safe data backfills, adjusting a generated type cast, adding a `USING` clause, splitting statements for safer execution, or preserving data during a rename. Keep the generated snapshot and journal exactly as Drizzle wrote them.

## Conflict resolution

Never resolve merge conflicts in migration SQL, snapshot JSON, or journal files manually.

When merging with `main` and migration conflicts appear:

1. Reset migrations to `origin/main`:

```bash
git restore --source=origin/main packages/db/migrations/
```

2. Re-run generation from the repository root:

```bash
pnpm migrations
```

3. Review the regenerated SQL. If needed, adapt only the generated `.sql` file.

## Validation

- Inspect `git diff packages/db/src/schema.ts packages/db/migrations/`.
- Confirm any snapshot JSON and journal changes came from `pnpm migrations`, not manual edits.
- Run `pnpm format` after changes.
- Run `pnpm build` after schema or migration changes.
