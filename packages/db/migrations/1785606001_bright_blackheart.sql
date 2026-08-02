ALTER TABLE "model_history" ADD COLUMN "total_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "total_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "total_cached_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "total_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "total_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "total_cached_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "total_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "total_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "total_cached_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "total_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "total_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "total_cached_input_cost" real DEFAULT 0 NOT NULL;