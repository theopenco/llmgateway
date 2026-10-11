ALTER TABLE "model_history" ADD COLUMN "total_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "total_cost" real DEFAULT 0 NOT NULL;