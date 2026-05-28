ALTER TABLE "message" ADD COLUMN "documents" text;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "provider_cache_control_enabled" boolean DEFAULT true NOT NULL;