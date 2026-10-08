ALTER TABLE "provider_draft_model" ADD COLUMN "rate_limit_mode" text DEFAULT 'strict' NOT NULL;--> statement-breakpoint
ALTER TABLE "rate_limit" ADD COLUMN "mode" text DEFAULT 'strict' NOT NULL;