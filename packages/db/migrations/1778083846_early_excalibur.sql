ALTER TABLE "api_key_hourly_model_stats" ADD COLUMN "cache_write_tokens" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_hourly_model_stats" ADD COLUMN "cache_write_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats" ADD COLUMN "cache_write_tokens" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats" ADD COLUMN "cache_write_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "cache_write_tokens" numeric;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "cache_write_input_cost" real;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "cache_write_input_price" numeric;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "cache_write_input_price1h" numeric;--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" ADD COLUMN "cache_write_tokens" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" ADD COLUMN "cache_write_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_stats" ADD COLUMN "cache_write_tokens" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_stats" ADD COLUMN "cache_write_input_cost" real DEFAULT 0 NOT NULL;