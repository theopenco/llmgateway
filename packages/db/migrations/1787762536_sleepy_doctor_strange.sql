ALTER TABLE "provider_claim" ADD COLUMN "kind" text DEFAULT 'catalogue' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "custom_name" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "custom_base_url" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "custom_description" text;