-- Build these out of band before deploying on a large database:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "model_provider_mapping_history_provider_stats_v3_idx"
--     ON "model_provider_mapping_history" ("minute_timestamp","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "mpm_history_hourly_provider_stats_v3_idx"
--     ON "model_provider_mapping_history_hourly" ("hour_timestamp","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");
--
-- CONCURRENTLY must run outside a transaction. IF NOT EXISTS makes the
-- migration a no-op for the new indexes after that pre-deploy step; small and
-- fresh databases build them inline. Keep the old covering indexes until last.
CREATE INDEX IF NOT EXISTS "model_provider_mapping_history_provider_stats_v3_idx" ON "model_provider_mapping_history" ("minute_timestamp","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mpm_history_hourly_provider_stats_v3_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");--> statement-breakpoint
DROP INDEX IF EXISTS "model_provider_mapping_history_provider_stats_v2_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "mpm_history_hourly_provider_stats_v2_idx";
