ALTER TABLE "model_provider_mapping" ADD COLUMN "deprecated_at" timestamp;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "deactivated_at" timestamp;--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "deprecated_at";--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "deactivated_at";