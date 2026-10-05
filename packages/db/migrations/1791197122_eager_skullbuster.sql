ALTER TABLE "provider_claim" ADD COLUMN "provider_key_id" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "pending_provider_key_id" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD CONSTRAINT "provider_claim_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("provider_key_id") REFERENCES "provider_key"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD CONSTRAINT "provider_claim_pending_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("pending_provider_key_id") REFERENCES "provider_key"("id") ON DELETE SET NULL;