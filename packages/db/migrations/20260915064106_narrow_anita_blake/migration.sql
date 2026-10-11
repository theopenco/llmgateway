ALTER TABLE "provider_model_verification" ADD COLUMN "initiated_by" text DEFAULT 'carrier' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_model_verification" ADD COLUMN "model_provider_mapping_id" text;--> statement-breakpoint
ALTER TABLE "provider_model_verification" ALTER COLUMN "provider_company_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "provider_model_verification_mapping_idx" ON "provider_model_verification" ("model_provider_mapping_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_model_verification_active_mapping_uidx" ON "provider_model_verification" ("model_provider_mapping_id") WHERE model_provider_mapping_id IS NOT NULL AND status IN ('queued', 'running');--> statement-breakpoint
ALTER TABLE "provider_model_verification" ADD CONSTRAINT "provider_model_verification_5NHEPU3skzoF_fkey" FOREIGN KEY ("model_provider_mapping_id") REFERENCES "model_provider_mapping"("id") ON DELETE CASCADE;