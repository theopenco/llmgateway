ALTER TABLE "global_model_stats" ADD COLUMN "provider_margin_amount" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "provider_margin_percent" real;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "provider_discount_percent" real;--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" ADD COLUMN "provider_margin_amount" real DEFAULT 0 NOT NULL;