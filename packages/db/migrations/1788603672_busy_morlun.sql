ALTER TABLE "organization" ADD COLUMN "subscription_payment_status" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
UPDATE "organization"
SET
	"subscription_payment_status" = 'past_due',
	"dev_plan_credits_limit" = COALESCE(
		"dev_plan_credits_limit_before_freeze",
		"dev_plan_credits_limit"
	)
WHERE "dev_plan_credits_frozen" = true;--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "dev_plan_credits_frozen";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "dev_plan_credits_limit_before_freeze";
