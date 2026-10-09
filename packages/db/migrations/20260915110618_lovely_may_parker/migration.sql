CREATE TABLE "content_filter_hourly_model_stats" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"used_model" text NOT NULL,
	"used_provider" text NOT NULL,
	"category" text NOT NULL,
	"sampled_count" integer DEFAULT 0 NOT NULL,
	"violation_count" integer DEFAULT 0 NOT NULL,
	"blocked_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "content_filter_hourly_model_stats_hour_timestamp_organization_id_project_id_used_model_used_provider_category_unique" UNIQUE("hour_timestamp","organization_id","project_id","used_model","used_provider","category")
);
--> statement-breakpoint
CREATE INDEX "content_filter_hourly_model_stats_org_ts_idx" ON "content_filter_hourly_model_stats" ("organization_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "content_filter_hourly_model_stats_model_ts_idx" ON "content_filter_hourly_model_stats" ("used_model","hour_timestamp");--> statement-breakpoint
CREATE INDEX "content_filter_hourly_model_stats_ts_idx" ON "content_filter_hourly_model_stats" ("hour_timestamp");