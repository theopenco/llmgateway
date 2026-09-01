ALTER TABLE "organization" ADD COLUMN "subscription_payment_status" text DEFAULT 'current' NOT NULL;--> statement-breakpoint
UPDATE "organization"
SET "subscription_payment_status" = 'past_due'
WHERE "dev_plan_credits_frozen" = true;
