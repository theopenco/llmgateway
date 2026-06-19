DROP INDEX "model_provider_mapping_status_idx";--> statement-breakpoint
CREATE INDEX "model_provider_mapping_model_id_status_idx" ON "model_provider_mapping" ("model_id","status");