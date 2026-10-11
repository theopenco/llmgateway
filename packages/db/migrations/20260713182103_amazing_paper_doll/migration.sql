ALTER TABLE "organization" ADD COLUMN "dev_plan_tier_change_claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "dev_plan_last_tier_change_cycle_start";