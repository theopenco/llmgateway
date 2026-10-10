ALTER TABLE "model_provider_mapping" ADD COLUMN "supported_tool_choices" json;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "supported_tool_choices" jsonb;