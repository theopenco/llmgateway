ALTER TABLE "organization" ADD COLUMN "subscription_payment_status" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
UPDATE "organization"
SET
	"subscription_payment_status" = 'past_due',
	"dev_plan_credits_limit" = COALESCE(
		"dev_plan_credits_limit_before_freeze",
		"dev_plan_credits_limit"
	)
WHERE "dev_plan_credits_frozen" = true AND "dev_plan" <> 'none';--> statement-breakpoint
UPDATE "organization"
SET
	"subscription_payment_status" = 'past_due',
	"chat_plan_credits_limit" = CASE "chat_plan"
		WHEN 'starter' THEN 18
		WHEN 'plus' THEN 47.5
		WHEN 'pro' THEN 147
	END
WHERE "chat_plan" IN ('starter', 'plus', 'pro')
	AND "chat_plan_stripe_subscription_id" IS NOT NULL
	AND "payment_failure_count" > 0
	AND "chat_plan_credits_limit" <= "chat_plan_credits_used";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "dev_plan_credits_frozen";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "dev_plan_credits_limit_before_freeze";
