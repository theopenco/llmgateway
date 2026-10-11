ALTER TABLE "model_provider_mapping" DROP CONSTRAINT "model_provider_mapping_model_id_provider_id_unique";--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD CONSTRAINT "model_provider_mapping_model_id_provider_id_region_unique" UNIQUE("model_id","provider_id","region");