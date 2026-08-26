-- Production rollout for populated history tables:
--
-- 1. Build the six replacement indexes out of band while the old worker is
--    still running. CONCURRENTLY must run outside a transaction:
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
-- 2. After the replacements are valid, remove the old covering indexes out of
--    band so their guarded drops below are also no-ops:
--
--   DROP INDEX CONCURRENTLY IF EXISTS "model_provider_mapping_history_provider_stats_v3_idx";
--   DROP INDEX CONCURRENTLY IF EXISTS "mpm_history_hourly_provider_stats_v3_idx";
--
-- 3. Stop every worker running the previous release before applying this
--    migration. Those workers use the old two-column ON CONFLICT targets, which
--    cannot coexist with separate credits and API-key rows. Apply the migration,
--    deploy the new worker, then resume processing.
--
-- A failed concurrent build can leave an INVALID index. Check pg_index.indisvalid
-- and drop an invalid index concurrently before retrying. Fresh databases can
-- build the guarded indexes inline.
CREATE UNIQUE INDEX IF NOT EXISTS "model_history_model_minute_mode_unique" ON "model_history" ("model_id","minute_timestamp","used_mode");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "model_history_model_hour_mode_unique" ON "model_history_hourly" ("model_id","hour_timestamp","used_mode");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mpm_history_mapping_minute_mode_unique" ON "model_provider_mapping_history" ("model_provider_mapping_id","minute_timestamp","used_mode");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mpm_history_mapping_hour_mode_unique" ON "model_provider_mapping_history_hourly" ("model_provider_mapping_id","hour_timestamp","used_mode");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_provider_mapping_history_provider_stats_v4_idx" ON "model_provider_mapping_history" ("minute_timestamp","used_mode","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "mpm_history_hourly_provider_stats_v4_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp","used_mode","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");--> statement-breakpoint
ALTER TABLE "model_history" ADD CONSTRAINT "model_history_model_minute_mode_unique" UNIQUE USING INDEX "model_history_model_minute_mode_unique";--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD CONSTRAINT "model_history_model_hour_mode_unique" UNIQUE USING INDEX "model_history_model_hour_mode_unique";--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD CONSTRAINT "mpm_history_mapping_minute_mode_unique" UNIQUE USING INDEX "mpm_history_mapping_minute_mode_unique";--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD CONSTRAINT "mpm_history_mapping_hour_mode_unique" UNIQUE USING INDEX "mpm_history_mapping_hour_mode_unique";--> statement-breakpoint
ALTER TABLE "model_history" DROP CONSTRAINT "model_history_model_id_minute_timestamp_unique";--> statement-breakpoint
ALTER TABLE "model_history_hourly" DROP CONSTRAINT "model_history_hourly_model_id_hour_timestamp_unique";--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" DROP CONSTRAINT "model_provider_mapping_history_model_provider_mapping_id_minute_timestamp_unique";--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" DROP CONSTRAINT "model_provider_mapping_history_hourly_model_provider_mapping_id_hour_timestamp_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "model_provider_mapping_history_provider_stats_v3_idx";--> statement-breakpoint
DROP INDEX IF EXISTS "mpm_history_hourly_provider_stats_v3_idx";
