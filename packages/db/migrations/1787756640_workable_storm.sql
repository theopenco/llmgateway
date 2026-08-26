ALTER TABLE "provider_claim" ADD COLUMN "logo_url" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "icon_url" text;--> statement-breakpoint
ALTER TABLE "provider_company" ADD COLUMN "payment_status" text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_company" ADD COLUMN "stripe_checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "provider_company" ADD COLUMN "paid_at" timestamp;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "max_rpm" integer;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "max_rpd" integer;