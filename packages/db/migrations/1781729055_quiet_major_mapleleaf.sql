-- Empty the derived hourly rollup tables first so the integer->bigint conversion
-- runs against empty tables (instant, no full-table rewrite / long ACCESS EXCLUSIVE
-- lock). The worker repopulates these from the minute-level history tables.
TRUNCATE TABLE "model_history_hourly";--> statement-breakpoint
TRUNCATE TABLE "model_provider_mapping_history_hourly";--> statement-breakpoint
ALTER TABLE "model_history_hourly" ALTER COLUMN "total_input_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ALTER COLUMN "total_output_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ALTER COLUMN "total_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ALTER COLUMN "total_reasoning_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ALTER COLUMN "total_cached_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ALTER COLUMN "total_input_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ALTER COLUMN "total_output_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ALTER COLUMN "total_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ALTER COLUMN "total_reasoning_tokens" SET DATA TYPE bigint;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ALTER COLUMN "total_cached_tokens" SET DATA TYPE bigint;