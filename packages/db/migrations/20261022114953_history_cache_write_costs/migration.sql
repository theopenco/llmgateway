-- migrate:reviewed Constant-default ADD COLUMNs are metadata-only (no rewrite), so each lock is held for milliseconds. The four history tables are only written by the worker's per-minute rollup, which retries; the runner's 5s lock_timeout backs off rather than queueing app reads.
ALTER TABLE "model_history" ADD COLUMN "total_cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "total_cache_write_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "total_cache_write_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "total_cache_write_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "total_cache_write_tokens" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "total_cache_write_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "total_cache_write_tokens" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "total_cache_write_input_cost" real DEFAULT 0 NOT NULL;