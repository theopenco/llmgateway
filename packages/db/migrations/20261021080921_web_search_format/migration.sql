-- migrate:reviewed both are nullable ADD COLUMNs without a default (catalog-only, no rewrite) on small catalogue tables, so the paired ACCESS EXCLUSIVE locks are momentary.
ALTER TABLE "model_provider_mapping" ADD COLUMN "web_search_format" text;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "web_search_format" text;
