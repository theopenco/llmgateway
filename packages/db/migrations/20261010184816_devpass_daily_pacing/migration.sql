ALTER TABLE "organization" ADD COLUMN "dev_plan_daily_credits_used" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "dev_plan_day_start" timestamp;