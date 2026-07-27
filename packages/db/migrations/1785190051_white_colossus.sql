ALTER TABLE "model_history" ADD COLUMN "time_to_first_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "time_to_first_reasoning_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "time_to_first_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "time_to_first_reasoning_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "time_to_first_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "time_to_first_reasoning_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "time_to_first_token_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "time_to_first_reasoning_token_count" integer DEFAULT 0 NOT NULL;