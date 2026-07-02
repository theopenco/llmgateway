ALTER TABLE "user_organization" ADD COLUMN "max_api_keys" integer;--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "period_usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "period_usage_duration_value" integer;--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "period_usage_duration_unit" text;