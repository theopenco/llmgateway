---
name: database
description: Query and change the LLM Gateway Postgres schema with Drizzle — reads, raw SQL, analytics and usage queries, the log table versus the hourly aggregation tables, used_model ids, cost sums, cached queries, and new columns. Use when editing packages/db/src/schema.ts, writing Drizzle or raw SQL, building dashboards, stats, or usage reports, adding an organization column, or pushing and seeding the local database. For migration files use the migrations skill.
---

# Database

Run commands from the repository root.

- `pnpm push` — push the schema to the dev (`pnpm push-dev`) and test (`pnpm push-test`) databases.
- `pnpm seed` — seed data.
- `pnpm run setup` — reset, push, and seed (use the `local-stack` skill first).

## Schema changes

Edit `packages/db/src/schema.ts`, then use the `migrations` skill. Refresh local
state with `pnpm run setup`. Production applies migrations before rolling out
new images, so new code may rely on new columns and backfills at startup.

A new `organization` column goes into `SerializedOrganization`'s `Omit` list
(`packages/db/src/types.ts`) when internal, or into the `/orgs` response schemas
when the dashboard shows it; `apps/ui` derives its type from it. Confirm with a
full `pnpm build`.

## Queries

- Use Drizzle's object syntax; reads via `db().query.<table>.findMany()` / `findFirst()`.
- Columns are camelCase in TypeScript and snake_case in the database (`casing: "snake_case"`); raw SQL uses `user_id`, not `userId`.
- Usage and analytics read the hourly aggregation tables: `project_hourly_stats`, `project_hourly_model_stats` (adds `used_model`/`used_provider`), `project_hourly_source_stats` (adds `source`), `api_key_hourly_stats`, `api_key_hourly_model_stats`, `global_model_stats`, `global_source_stats`. Join `project` → `organization` for org fields such as `billing_email`. Query `log` only for data no aggregate holds (payloads, `request_id` lookups, individual finish reasons), and say why.
- `log` is per-request volume. Retention nulls its payload columns; rows and token/cost columns remain.
- The gateway request path reads no `log` rows at all; hot-path signals come from Redis counters maintained on the write path or small cached rows.
- `used_model` stores `provider/model[:region]`. Compare with catalogue ids after `split_part(split_part(used_model, '/', 2), ':', 1)` (as in `stats-calculator.ts`), and use the same shape in seeds and fixtures.
- Cost columns are `real`, and `SUM(real)` accumulates in float4. Sum as `SUM(CAST(col AS DOUBLE PRECISION))`; for exact reads `SUM(CAST(CAST(col AS DOUBLE PRECISION) AS NUMERIC))`. `real::numeric` rounds to 6 digits.
- Coordinate settings updates by validating state at each write boundary; advisory locks such as `pg_advisory_xact_lock` are not used.

## Cached client

The cached client stores positional driver rows. Cache keys are namespaced by
`SCHEMA_CACHE_VERSION` (derived from `schema.ts`) and `runMigrations` clears
them, so a column change needs no manual bump.
