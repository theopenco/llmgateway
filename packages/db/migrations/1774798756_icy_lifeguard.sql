ALTER TABLE "api_key" ADD COLUMN "period_usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "period_usage_duration_value" integer;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "period_usage_duration_unit" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "current_period_usage" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "current_period_started_at" timestamp;