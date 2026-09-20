ALTER TABLE "organization" ADD COLUMN "subscription_payment_status" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
UPDATE "organization"
SET
	"subscription_payment_status" = 'past_due',
	"dev_plan_credits_limit" = COALESCE(
		"dev_plan_credits_limit_before_freeze",
		"dev_plan_credits_limit"
	)
WHERE "dev_plan_credits_frozen" = true AND "dev_plan" <> 'none';--> statement-breakpoint
-- Chat plans had no freeze flag: the freeze clamped the limit to exactly what
-- was already used, and recovery raised it back to the tier allowance. Match
-- that fingerprint rather than payment_failure_count, which is not reset when a
-- subscription invoice succeeds and so survives recovery.
UPDATE "organization" AS o
SET
	"subscription_payment_status" = 'past_due',
	"chat_plan_credits_limit" = t.allowance
FROM (VALUES ('starter', 18), ('plus', 47.5), ('pro', 147)) AS t(plan, allowance)
WHERE o."chat_plan" = t.plan
	AND o."chat_plan_stripe_subscription_id" IS NOT NULL
	AND o."chat_plan_credits_limit" = o."chat_plan_credits_used"
	AND o."chat_plan_credits_limit" < t.allowance;--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "dev_plan_credits_frozen";--> statement-breakpoint
ALTER TABLE "organization" DROP COLUMN "dev_plan_credits_limit_before_freeze";
