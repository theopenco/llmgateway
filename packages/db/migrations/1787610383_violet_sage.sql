-- The production startup migrator runs these commands in autocommit before
-- Drizzle opens its migration transaction. Adding a constant-default column is
-- metadata-only; the old worker safely writes "unknown" until the constraint
-- cutover. They are listed here for operational visibility:
--
--   ALTER TABLE "model_history" ADD COLUMN IF NOT EXISTS "used_mode" text DEFAULT 'unknown' NOT NULL;
--   ALTER TABLE "model_history_hourly" ADD COLUMN IF NOT EXISTS "used_mode" text DEFAULT 'unknown' NOT NULL;
--   ALTER TABLE "model_provider_mapping_history" ADD COLUMN IF NOT EXISTS "used_mode" text DEFAULT 'unknown' NOT NULL;
--   ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN IF NOT EXISTS "used_mode" text DEFAULT 'unknown' NOT NULL;
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
-- The conditional statements below then become no-ops. Fresh databases, where
-- the tables do not exist during the pre-migration phase, build inline. The old
-- constraints and indexes remain until all replacements exist.
ALTER TABLE "model_history" ADD COLUMN IF NOT EXISTS "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN IF NOT EXISTS "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN IF NOT EXISTS "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN IF NOT EXISTS "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
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
