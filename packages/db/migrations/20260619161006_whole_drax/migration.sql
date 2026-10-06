DROP INDEX "model_provider_mapping_status_idx";--> statement-breakpoint
CREATE INDEX "model_provider_mapping_status_model_id_idx" ON "model_provider_mapping" ("status","model_id");