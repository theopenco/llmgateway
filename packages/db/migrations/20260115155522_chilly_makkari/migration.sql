ALTER TABLE "organization" ADD COLUMN "is_personal" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "dev_plan" text DEFAULT 'none' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "dev_plan_credits_used" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "dev_plan_credits_limit" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "dev_plan_billing_cycle_start" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "dev_plan_stripe_subscription_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "dev_plan_cancelled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "dev_plan_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_dev_plan_stripe_subscription_id_key" UNIQUE("dev_plan_stripe_subscription_id");