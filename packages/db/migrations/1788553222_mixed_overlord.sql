CREATE TABLE "provider_model_verification" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_company_id" text NOT NULL,
	"draft_model_id" text,
	"requested_by" text,
	"target" jsonb NOT NULL,
	"checks" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"credential_ciphertext" text,
	"credential_source" text DEFAULT 'supplied' NOT NULL,
	"summary" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"submitted_at" timestamp
);
--> statement-breakpoint
DROP INDEX "provider_routing_filing_pending_provider_uidx";--> statement-breakpoint
DROP INDEX "provider_routing_settings_provider_uidx";--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "api_format" text;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "api_format" text DEFAULT 'provider-native' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "json_output_schema" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "reasoning_max_tokens" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "web_search" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_routing_filing" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "provider_routing_settings" ADD COLUMN "model_id" text;--> statement-breakpoint
CREATE INDEX "provider_model_verification_company_idx" ON "provider_model_verification" ("provider_company_id","created_at");--> statement-breakpoint
CREATE INDEX "provider_model_verification_model_idx" ON "provider_model_verification" ("draft_model_id","created_at");--> statement-breakpoint
CREATE INDEX "provider_model_verification_queue_idx" ON "provider_model_verification" ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_model_verification_active_model_uidx" ON "provider_model_verification" ("draft_model_id") WHERE draft_model_id IS NOT NULL AND status IN ('queued', 'running');--> statement-breakpoint
CREATE UNIQUE INDEX "provider_routing_filing_pending_default_uidx" ON "provider_routing_filing" ("provider_id") WHERE model_id IS NULL AND status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "provider_routing_filing_pending_model_uidx" ON "provider_routing_filing" ("provider_id","model_id") WHERE model_id IS NOT NULL AND status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "provider_routing_settings_provider_default_uidx" ON "provider_routing_settings" ("provider_id") WHERE model_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_routing_settings_provider_model_uidx" ON "provider_routing_settings" ("provider_id","model_id") WHERE model_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_model_verification" ADD CONSTRAINT "provider_model_verification_urLU4QwMtkGv_fkey" FOREIGN KEY ("provider_company_id") REFERENCES "provider_company"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_model_verification" ADD CONSTRAINT "provider_model_verification_k085IiDTJM2d_fkey" FOREIGN KEY ("draft_model_id") REFERENCES "provider_draft_model"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_model_verification" ADD CONSTRAINT "provider_model_verification_requested_by_user_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE SET NULL;