ALTER TABLE "api_key_hourly_model_stats" ADD COLUMN "cached_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats" ADD COLUMN "cached_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" ADD COLUMN "cached_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_stats" ADD COLUMN "cached_input_cost" real DEFAULT 0 NOT NULL;