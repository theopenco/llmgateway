ALTER TABLE "provider_claim" ADD COLUMN "verification_key_ciphertext" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "verification_key_masked" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "verification_key_updated_at" timestamp;