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