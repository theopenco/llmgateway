CREATE TABLE "content_filter_hourly_error_stats" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"classifier" text NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"input_type" text DEFAULT '' NOT NULL,
	"status" integer DEFAULT 0 NOT NULL,
	"code" text DEFAULT '' NOT NULL,
	"error_count" integer DEFAULT 0 NOT NULL,
	"last_message" text DEFAULT '' NOT NULL,
	"last_request_id" text DEFAULT '' NOT NULL,
	"last_seen_at" timestamp NOT NULL,
	CONSTRAINT "content_filter_hourly_error_stats_bucket_unique" UNIQUE("hour_timestamp","organization_id","project_id","classifier","source","kind","input_type","status","code")
);
--> statement-breakpoint
CREATE INDEX "content_filter_hourly_error_stats_ts_idx" ON "content_filter_hourly_error_stats" ("hour_timestamp");--> statement-breakpoint
CREATE INDEX "content_filter_hourly_error_stats_org_ts_idx" ON "content_filter_hourly_error_stats" ("organization_id","hour_timestamp");