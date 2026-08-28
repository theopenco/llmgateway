ALTER TABLE "provider_company" ADD COLUMN "website_verification_token" text;--> statement-breakpoint
ALTER TABLE "provider_company" ADD COLUMN "website_verified_domain" text;--> statement-breakpoint
ALTER TABLE "provider_company" ADD COLUMN "website_verified_at" timestamp;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "rate_limit_scope" text DEFAULT 'global' NOT NULL;