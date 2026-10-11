CREATE INDEX IF NOT EXISTS "model_history_model_id_minute_timestamp_idx" ON "model_history" ("model_id","minute_timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_provider_mapping_history_model_id_minute_timestamp_idx" ON "model_provider_mapping_history" ("model_id","minute_timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "model_provider_mapping_history_id_ts_idx" ON "model_provider_mapping_history" ("provider_id","model_id","minute_timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_hourly_model_stats_used_model_hour_timestamp_idx" ON "project_hourly_model_stats" ("used_model","hour_timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_hourly_model_stats_p_m_time_idx" ON "project_hourly_model_stats" ("used_provider","used_model","hour_timestamp");
