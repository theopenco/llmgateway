-- Before deploying to an existing database, build these indexes outside a
-- transaction so scans do not block writes to the history and billing tables:
--
-- CREATE INDEX CONCURRENTLY "global_model_stats_provider_margin_idx" ON "global_model_stats" ("used_provider","used_mode","day_timestamp","provider_margin_amount");
-- CREATE INDEX CONCURRENTLY "organization_created_at_idx" ON "organization" ("created_at");
-- CREATE INDEX CONCURRENTLY "project_hourly_stats_dashboard_spend_idx" ON "project_hourly_stats" ("hour_timestamp","project_id","cost","credits_cost","api_keys_cost","api_keys_data_storage_cost");
-- CREATE INDEX CONCURRENTLY "transaction_status_created_at_idx" ON "transaction" ("status","created_at");
-- CREATE INDEX CONCURRENTLY "transaction_organization_type_idx" ON "transaction" ("organization_id","type");
-- CREATE INDEX CONCURRENTLY "user_created_at_verified_idx" ON "user" ("created_at","email_verified");
--
-- Verify all six indexes have pg_index.indisvalid = true before deploying.
-- A failed build leaves an invalid index: drop it CONCURRENTLY before retrying.
-- IF NOT EXISTS adopts those prebuilt indexes; fresh databases build inline.
CREATE INDEX IF NOT EXISTS "global_model_stats_provider_margin_idx" ON "global_model_stats" ("used_provider","used_mode","day_timestamp","provider_margin_amount");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "organization_created_at_idx" ON "organization" ("created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "project_hourly_stats_dashboard_spend_idx" ON "project_hourly_stats" ("hour_timestamp","project_id","cost","credits_cost","api_keys_cost","api_keys_data_storage_cost");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_status_created_at_idx" ON "transaction" ("status","created_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_organization_type_idx" ON "transaction" ("organization_id","type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_created_at_verified_idx" ON "user" ("created_at","email_verified");