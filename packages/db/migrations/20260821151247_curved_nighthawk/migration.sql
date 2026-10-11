ALTER TABLE "project" ADD COLUMN "provider_cache_control_mode" text DEFAULT 'auto' NOT NULL;--> statement-breakpoint
-- Preserve opt-outs: the old boolean's false meant "strip every marker", which is now "off".
UPDATE "project" SET "provider_cache_control_mode" = 'off' WHERE "provider_cache_control_enabled" = false;--> statement-breakpoint
ALTER TABLE "project" DROP COLUMN "provider_cache_control_enabled";
