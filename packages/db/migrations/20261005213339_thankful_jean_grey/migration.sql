ALTER TABLE "provider_claim" ADD COLUMN "website" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "privacy_policy_url" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "terms_url" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "status_page_url" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "legal_entity" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "headquarters" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "api_training" boolean;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "prompt_logging" boolean;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "retention_period" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "gdpr" boolean;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "soc2" integer;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "iso27001" boolean;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "profile_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "provider_company" ADD COLUMN "terms_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "provider_company" ADD COLUMN "terms_accepted_by" text;--> statement-breakpoint
ALTER TABLE "provider_company" ADD CONSTRAINT "provider_company_terms_accepted_by_user_id_fkey" FOREIGN KEY ("terms_accepted_by") REFERENCES "user"("id") ON DELETE SET NULL;