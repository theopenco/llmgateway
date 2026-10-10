-- Build both out of band BEFORE deploying this migration, otherwise the
-- migrator scans all of "log" while holding a lock on it:
--
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "log_realtime_session_usage_key_unique"
--     ON "log" ("realtime_session_id","realtime_usage_key") WHERE realtime_usage_key IS NOT NULL;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "log_realtime_unsettled_organization_id_idx"
--     ON "log" ("organization_id") WHERE realtime_session_id IS NOT NULL AND processed_at IS NULL;
--
-- Run those with psql (autocommit) — CONCURRENTLY cannot run in a transaction —
-- then check pg_index.indisvalid: a failed concurrent build leaves an INVALID
-- index that must be dropped with DROP INDEX CONCURRENTLY before retrying.
--
-- IF NOT EXISTS then makes this migration a no-op there, while small databases
-- (dev, CI, fresh installs) just build the indexes inline.
CREATE UNIQUE INDEX IF NOT EXISTS "log_realtime_session_usage_key_unique" ON "log" ("realtime_session_id","realtime_usage_key") WHERE realtime_usage_key IS NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "log_realtime_unsettled_organization_id_idx" ON "log" ("organization_id") WHERE realtime_session_id IS NOT NULL AND processed_at IS NULL;
