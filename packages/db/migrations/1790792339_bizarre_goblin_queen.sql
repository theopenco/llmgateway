ALTER TABLE "model_provider_mapping" ADD COLUMN "cache_read_input_price" numeric;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "min_cacheable_tokens" integer;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "max_temperature" real;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "supports_developer_role" boolean;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "supports_assistant_prefill" boolean;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "web_search_forced_only" boolean;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "catalogue_metadata" jsonb;