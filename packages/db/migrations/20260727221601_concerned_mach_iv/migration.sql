-- The two *_provider_stats_v2_idx indexes replace the *_provider_stats_idx ones
-- with `time_to_first_token_count` added, so the public provider-stats
-- aggregation stays an index-only scan now that it sums that column too.
--
-- Build both out of band BEFORE deploying this migration, otherwise the
-- migrator scans all of "model_provider_mapping_history" while holding a lock
-- on it — and the worker writes to that table every minute:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "model_provider_mapping_history_provider_stats_v2_idx"
--     ON "model_provider_mapping_history" ("minute_timestamp","provider_id","logs_count","errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "mpm_history_hourly_provider_stats_v2_idx"
--     ON "model_provider_mapping_history_hourly" ("hour_timestamp","provider_id","logs_count","errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");
--
-- Run those with psql (autocommit) — CONCURRENTLY cannot run in a transaction —
-- then check pg_index.indisvalid: a failed concurrent build leaves an INVALID
-- index that must be dropped with DROP INDEX CONCURRENTLY before retrying.
--
-- IF NOT EXISTS then makes the creates a no-op here, while small databases
-- (dev, CI, fresh installs) just build them inline. The old indexes are dropped
-- last so reads keep a usable index throughout.
--
-- This is deliberately a separate migration from the one adding
-- time_to_first_token_count: the columns had to land first so the concurrent
-- index build above can reference them.
CREATE INDEX IF NOT EXISTS "model_provider_mapping_history_provider_stats_v2_idx" ON "model_provider_mapping_history" ("minute_timestamp","provider_id","logs_count","errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mpm_history_hourly_provider_stats_v2_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp","provider_id","logs_count","errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");--> statement-breakpoint
DROP INDEX IF EXISTS "model_provider_mapping_history_provider_stats_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "mpm_history_hourly_provider_stats_idx";
