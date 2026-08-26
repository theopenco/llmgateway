ALTER TABLE "model_provider_mapping" ADD COLUMN "reasoning_efforts" json;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "audio" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "reasoning_efforts" jsonb;