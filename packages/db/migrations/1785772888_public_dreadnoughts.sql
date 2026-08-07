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
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_managed_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("managed_provider_key_id") REFERENCES "provider_key"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("provider_key_id") REFERENCES "provider_key"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ADD CONSTRAINT "provider_key_token_xor" CHECK (("token" IS NULL) <> ("token_ciphertext" IS NULL));--> statement-breakpoint
ALTER TABLE "provider_key" ADD CONSTRAINT "provider_key_managed_org_scope" CHECK (("managed" = true AND "organization_id" IS NULL) OR ("managed" = false AND "organization_id" IS NOT NULL));