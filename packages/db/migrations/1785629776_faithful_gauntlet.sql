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
CREATE INDEX "provider_key_hourly_stats_key_id_hour_timestamp_idx" ON "provider_key_hourly_stats" ("provider_key_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "provider_key_hourly_stats_project_id_hour_timestamp_idx" ON "provider_key_hourly_stats" ("project_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "provider_key_hourly_stats_hour_timestamp_idx" ON "provider_key_hourly_stats" ("hour_timestamp");