ALTER TABLE "project" ADD COLUMN "semantic_cache_mode" text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "semantic_cache_threshold" real DEFAULT 0.95 NOT NULL;