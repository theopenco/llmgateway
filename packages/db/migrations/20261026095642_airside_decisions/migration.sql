-- migrate:reviewed both are small catalogue tables; a constant-default ADD COLUMN is metadata-only and takes the locks briefly
ALTER TABLE "model_provider_mapping" ADD COLUMN "decisions" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "decisions" boolean DEFAULT false NOT NULL;
