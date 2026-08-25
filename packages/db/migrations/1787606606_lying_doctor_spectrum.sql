ALTER TABLE "model_history" DROP CONSTRAINT "model_history_model_id_minute_timestamp_unique";--> statement-breakpoint
ALTER TABLE "model_history_hourly" DROP CONSTRAINT "model_history_hourly_model_id_hour_timestamp_unique";--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" DROP CONSTRAINT "model_provider_mapping_history_model_provider_mapping_id_minute_timestamp_unique";--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" DROP CONSTRAINT "model_provider_mapping_history_hourly_model_provider_mapping_id_hour_timestamp_unique";--> statement-breakpoint
DROP INDEX "model_provider_mapping_history_provider_stats_v3_idx";--> statement-breakpoint
DROP INDEX "mpm_history_hourly_provider_stats_v3_idx";--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history" ADD CONSTRAINT "model_history_model_minute_mode_unique" UNIQUE("model_id","minute_timestamp","used_mode");--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD CONSTRAINT "model_history_model_hour_mode_unique" UNIQUE("model_id","hour_timestamp","used_mode");--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD CONSTRAINT "mpm_history_mapping_minute_mode_unique" UNIQUE("model_provider_mapping_id","minute_timestamp","used_mode");--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD CONSTRAINT "mpm_history_mapping_hour_mode_unique" UNIQUE("model_provider_mapping_id","hour_timestamp","used_mode");--> statement-breakpoint
CREATE INDEX "model_provider_mapping_history_provider_stats_v4_idx" ON "model_provider_mapping_history" ("minute_timestamp","used_mode","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");--> statement-breakpoint
CREATE INDEX "mpm_history_hourly_provider_stats_v4_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp","used_mode","provider_id","logs_count","errors_count","client_errors_count","cached_count","total_time_to_first_token","time_to_first_token_count","total_output_tokens","total_duration");