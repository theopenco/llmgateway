ALTER TABLE "model_history" ADD COLUMN "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history_hourly" ADD COLUMN "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly" ADD COLUMN "used_mode" text DEFAULT 'unknown' NOT NULL;