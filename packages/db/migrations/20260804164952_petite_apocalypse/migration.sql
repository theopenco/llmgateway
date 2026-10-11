-- "log" is the largest table in the database, so building this inline makes
-- the migrator scan all of it while holding a lock. Deploy the migration that
-- adds log.provider_key_id FIRST (it ships in the preceding migration), then
-- build this out of band BEFORE deploying this one:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "log_provider_key_id_created_at_idx"
--     ON "log" ("provider_key_id","created_at") WHERE provider_key_id IS NOT NULL;
--
-- Ordering matters: run against a database that has not yet applied the
-- column-adding migration and this fails with 42703 (column does not exist).
--
-- Run it with psql (autocommit) — CONCURRENTLY cannot run in a transaction —
-- then check pg_index.indisvalid: a failed concurrent build leaves an INVALID
-- index that must be dropped with DROP INDEX CONCURRENTLY before retrying.
--
-- IF NOT EXISTS then makes this statement a no-op there, while small databases
-- (dev, CI, fresh installs) just build the index inline.
CREATE INDEX IF NOT EXISTS "log_provider_key_id_created_at_idx" ON "log" ("provider_key_id","created_at") WHERE provider_key_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "provider_key_sort_order_idx" ON "provider_key" ("organization_id","provider","sort_order");--> statement-breakpoint
CREATE INDEX "provider_key_managed_provider_idx" ON "provider_key" ("managed","provider");--> statement-breakpoint
CREATE INDEX "provider_key_hourly_stats_key_id_hour_timestamp_idx" ON "provider_key_hourly_stats" ("provider_key_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "provider_key_hourly_stats_project_id_hour_timestamp_idx" ON "provider_key_hourly_stats" ("project_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "provider_key_hourly_stats_hour_timestamp_idx" ON "provider_key_hourly_stats" ("hour_timestamp");