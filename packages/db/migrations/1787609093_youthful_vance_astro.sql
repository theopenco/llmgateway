-- Deploy the preceding used_mode column migration first, then build these
-- indexes out of band before deploying this migration on a large database:
--
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "model_history_model_minute_mode_unique"
--     ON "model_history" ("model_id","minute_timestamp","used_mode");
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "model_history_model_hour_mode_unique"
--     ON "model_history_hourly" ("model_id","hour_timestamp","used_mode");
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "mpm_history_mapping_minute_mode_unique"
--     ON "model_provider_mapping_history" ("model_provider_mapping_id","minute_timestamp","used_mode");
--   CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "mpm_history_mapping_hour_mode_unique"
--     ON "model_provider_mapping_history_hourly" ("model_provider_mapping_id","hour_timestamp","used_mode");
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "model_provider_mapping_history_provider_stats_v4_idx"
--     ON "model_provider_mapping_history" ("minute_timestamp","used_mode","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "mpm_history_hourly_provider_stats_v4_idx"
--     ON "model_provider_mapping_history_hourly" ("hour_timestamp","used_mode","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");
--
-- CONCURRENTLY must run outside a transaction. IF NOT EXISTS makes the
-- migration a no-op for prebuilt indexes; small and fresh databases build
-- them inline. The old constraints and covering indexes remain until the
-- replacements exist.
CREATE UNIQUE INDEX IF NOT EXISTS "model_history_model_minute_mode_unique" ON "model_history" ("model_id","minute_timestamp","used_mode");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_history_model_hour_mode_unique" ON "model_history_hourly" ("model_id","hour_timestamp","used_mode");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mpm_history_mapping_minute_mode_unique" ON "model_provider_mapping_history" ("model_provider_mapping_id","minute_timestamp","used_mode");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mpm_history_mapping_hour_mode_unique" ON "model_provider_mapping_history_hourly" ("model_provider_mapping_id","hour_timestamp","used_mode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_provider_mapping_history_provider_stats_v4_idx" ON "model_provider_mapping_history" ("minute_timestamp","used_mode","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mpm_history_hourly_provider_stats_v4_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp","used_mode","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");--> statement-breakpoint
ALTER TABLE "model_history" DROP CONSTRAINT "model_history_model_id_minute_timestamp_unique";--> statement-breakpoint
ALTER TABLE "model_history_hourly" DROP CONSTRAINT "model_history_hourly_model_id_hour_timestamp_unique";--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" DROP CONSTRAINT "model_provider_mapping_history_model_provider_mapping_id_minute_timestamp_unique";--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" DROP CONSTRAINT "model_provider_mapping_history_hourly_model_provider_mapping_id_hour_timestamp_unique";--> statement-breakpoint
ALTER TABLE "model_history" ADD CONSTRAINT "model_history_model_minute_mode_unique" UNIQUE USING INDEX "model_history_model_minute_mode_unique";--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD CONSTRAINT "model_history_model_hour_mode_unique" UNIQUE USING INDEX "model_history_model_hour_mode_unique";--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD CONSTRAINT "mpm_history_mapping_minute_mode_unique" UNIQUE USING INDEX "mpm_history_mapping_minute_mode_unique";--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD CONSTRAINT "mpm_history_mapping_hour_mode_unique" UNIQUE USING INDEX "mpm_history_mapping_hour_mode_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "model_provider_mapping_history_provider_stats_v3_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "mpm_history_hourly_provider_stats_v3_idx";
