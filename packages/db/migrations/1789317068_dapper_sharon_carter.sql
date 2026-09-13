CREATE TABLE "content_filter_hourly_stats" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"category" text NOT NULL,
	"sampled_count" integer DEFAULT 0 NOT NULL,
	"violation_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "content_filter_hourly_stats_hour_timestamp_organization_id_project_id_category_unique" UNIQUE("hour_timestamp","organization_id","project_id","category")
);
--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "gateway_content_filter_evaluation" jsonb;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "content_filter_tier_override" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "content_filter_log_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "content_filter_hourly_stats_org_ts_idx" ON "content_filter_hourly_stats" ("organization_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "content_filter_hourly_stats_ts_idx" ON "content_filter_hourly_stats" ("hour_timestamp");