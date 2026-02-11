DROP TABLE "api_key_hourly_model_stats";--> statement-breakpoint
DROP TABLE "api_key_hourly_stats";--> statement-breakpoint
DROP TABLE "project_hourly_model_stats";--> statement-breakpoint
DROP TABLE "project_hourly_stats";--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "reasoning_max_tokens" integer;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "supports_reasoning_max_tokens" boolean;