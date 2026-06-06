ALTER TABLE "organization" ADD COLUMN "stripe_connect_account_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "stripe_connect_onboarded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_stripe_connect_account_id_key" UNIQUE("stripe_connect_account_id");