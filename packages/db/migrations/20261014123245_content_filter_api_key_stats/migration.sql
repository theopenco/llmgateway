CREATE TABLE "content_filter_hourly_api_key_stats" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"category" text NOT NULL,
	"classifier" text NOT NULL,
	"role" text DEFAULT 'deciding' NOT NULL,
	"sampled_count" integer DEFAULT 0 NOT NULL,
	"violation_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "content_filter_hourly_api_key_stats_bucket_unique" UNIQUE("hour_timestamp","organization_id","project_id","api_key_id","category","classifier","role")
);
--> statement-breakpoint
CREATE INDEX "content_filter_hourly_api_key_stats_org_ts_idx" ON "content_filter_hourly_api_key_stats" ("organization_id","hour_timestamp");