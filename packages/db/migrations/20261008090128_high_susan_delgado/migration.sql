-- Both hourly history tables are large and the worker upserts into them every
-- minute, so building these inline would block those writes for the duration
-- of the scan. Build them out of band BEFORE deploying this migration:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "model_history_hourly_active_model_stats_v1_idx" ON "model_history_hourly" ("hour_timestamp","model_id","total_tokens","logs_count") WHERE logs_count > 0;
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "mpm_history_hourly_active_provider_stats_v1_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp","used_mode","provider_id","logs_count","client_errors_count","gateway_errors_count","upstream_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_time_to_first_reasoning_token","time_to_first_reasoning_token_count","total_output_tokens","total_tokens","total_duration") WHERE logs_count > 0;
--
-- Run them with psql (autocommit) — CONCURRENTLY cannot run in a transaction —
-- then check pg_index.indisvalid: a failed concurrent build leaves an INVALID
-- index that must be dropped with DROP INDEX CONCURRENTLY before retrying.
--
-- IF NOT EXISTS then makes these statements a no-op there, while small
-- databases (dev, CI, fresh installs) just build the indexes inline.
CREATE INDEX IF NOT EXISTS "model_history_hourly_active_model_stats_v1_idx" ON "model_history_hourly" ("hour_timestamp","model_id","total_tokens","logs_count") WHERE logs_count > 0;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mpm_history_hourly_active_provider_stats_v1_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp","used_mode","provider_id","logs_count","client_errors_count","gateway_errors_count","upstream_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_time_to_first_reasoning_token","time_to_first_reasoning_token_count","total_output_tokens","total_tokens","total_duration") WHERE logs_count > 0;
