DROP INDEX "provider_routing_filing_pending_provider_uidx";--> statement-breakpoint
DROP INDEX "provider_routing_settings_provider_uidx";--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "api_format" text;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "api_format" text DEFAULT 'provider-native' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_routing_filing" ADD COLUMN "model_id" text;--> statement-breakpoint
ALTER TABLE "provider_routing_settings" ADD COLUMN "model_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_routing_filing_pending_default_uidx" ON "provider_routing_filing" ("provider_id") WHERE model_id IS NULL AND status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "provider_routing_filing_pending_model_uidx" ON "provider_routing_filing" ("provider_id","model_id") WHERE model_id IS NOT NULL AND status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "provider_routing_settings_provider_default_uidx" ON "provider_routing_settings" ("provider_id") WHERE model_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_routing_settings_provider_model_uidx" ON "provider_routing_settings" ("provider_id","model_id") WHERE model_id IS NOT NULL;