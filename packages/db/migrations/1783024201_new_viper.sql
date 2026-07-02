ALTER TABLE "organization" ADD COLUMN "default_developer_max_api_keys" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_developer_usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_developer_period_usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_developer_period_usage_duration_value" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_developer_period_usage_duration_unit" text;