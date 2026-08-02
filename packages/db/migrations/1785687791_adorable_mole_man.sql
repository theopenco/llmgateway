CREATE TABLE "provider_key_hourly_stats" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_key_id" text NOT NULL,
	"project_id" text NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"upstream_error_count" integer DEFAULT 0 NOT NULL,
	"cache_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" numeric DEFAULT '0' NOT NULL,
	"output_tokens" numeric DEFAULT '0' NOT NULL,
	"total_tokens" numeric DEFAULT '0' NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	CONSTRAINT "provider_key_hourly_stats_key_project_hour_unique" UNIQUE("provider_key_id","project_id","hour_timestamp")
);
--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "provider_key_id" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "token_masked" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "variant" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "usage" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "sort_order" integer;--> statement-breakpoint
ALTER TABLE "video_job" ADD COLUMN "managed_provider_key_id" text;--> statement-breakpoint
ALTER TABLE "video_job" ADD COLUMN "provider_key_id" text;--> statement-breakpoint
ALTER TABLE "provider_key" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
-- Build this out of band BEFORE deploying this migration, otherwise the
-- migrator scans all of "log" while holding a lock on it:
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS "log_provider_key_id_created_at_idx"
--     ON "log" ("provider_key_id","created_at") WHERE provider_key_id IS NOT NULL;
--
-- Run it with psql (autocommit) — CONCURRENTLY cannot run in a transaction —
-- then check pg_index.indisvalid: a failed concurrent build leaves an INVALID
-- index that must be dropped with DROP INDEX CONCURRENTLY before retrying.
--
-- IF NOT EXISTS then makes this migration a no-op there, while small databases
-- (dev, CI, fresh installs) just build the index inline.
CREATE INDEX IF NOT EXISTS "log_provider_key_id_created_at_idx" ON "log" ("provider_key_id","created_at") WHERE provider_key_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "provider_key_sort_order_idx" ON "provider_key" ("organization_id","provider","sort_order");--> statement-breakpoint
CREATE INDEX "provider_key_managed_provider_idx" ON "provider_key" ("managed","provider");--> statement-breakpoint
CREATE INDEX "provider_key_hourly_stats_key_id_hour_timestamp_idx" ON "provider_key_hourly_stats" ("provider_key_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "provider_key_hourly_stats_project_id_hour_timestamp_idx" ON "provider_key_hourly_stats" ("project_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "provider_key_hourly_stats_hour_timestamp_idx" ON "provider_key_hourly_stats" ("hour_timestamp");--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_managed_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("managed_provider_key_id") REFERENCES "provider_key"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("provider_key_id") REFERENCES "provider_key"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ADD CONSTRAINT "provider_key_token_xor" CHECK (("token" IS NULL) <> ("token_ciphertext" IS NULL));--> statement-breakpoint
ALTER TABLE "provider_key" ADD CONSTRAINT "provider_key_managed_org_scope" CHECK (("managed" = true AND "organization_id" IS NULL) OR ("managed" = false AND "organization_id" IS NOT NULL));