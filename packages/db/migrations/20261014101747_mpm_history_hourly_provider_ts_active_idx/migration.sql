-- Before deploying to an existing database, build this index outside a
-- transaction so the build does not block writes to the history table:
--
-- CREATE INDEX CONCURRENTLY "mpm_history_hourly_provider_ts_active_idx" ON "model_provider_mapping_history_hourly" ("provider_id","hour_timestamp","model_provider_mapping_id","logs_count","total_cost","client_errors_count","gateway_errors_count","upstream_errors_count") WHERE logs_count > 0;
--
-- Verify pg_index.indisvalid = true before deploying. A failed build leaves an
-- invalid index: drop it CONCURRENTLY before retrying.
-- IF NOT EXISTS adopts the prebuilt index; fresh databases build inline.
CREATE INDEX IF NOT EXISTS "mpm_history_hourly_provider_ts_active_idx" ON "model_provider_mapping_history_hourly" ("provider_id","hour_timestamp","model_provider_mapping_id","logs_count","total_cost","client_errors_count","gateway_errors_count","upstream_errors_count") WHERE logs_count > 0;