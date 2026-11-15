CREATE TABLE "project_hourly_web_search_stats" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"project_id" text NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"web_search_engine" text NOT NULL,
	"used_provider" text NOT NULL,
	"used_mode" text NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"search_count" integer DEFAULT 0 NOT NULL,
	"web_search_cost" real DEFAULT 0 NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	CONSTRAINT "project_hourly_web_search_stats_project_id_hour_timestamp_web_search_engine_used_provider_used_mode_unique" UNIQUE("project_id","hour_timestamp","web_search_engine","used_provider","used_mode")
);
--> statement-breakpoint
-- migrate:reviewed log and organization each get nullable ADD COLUMNs with no default: catalog-only changes that hold the lock for milliseconds.
ALTER TABLE "log" ADD COLUMN "web_search_engine" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "web_search_count" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "web_search_engine" text;--> statement-breakpoint
CREATE INDEX "project_hourly_web_search_stats_project_id_hour_timestamp_idx" ON "project_hourly_web_search_stats" ("project_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "project_hourly_web_search_stats_hour_timestamp_engine_idx" ON "project_hourly_web_search_stats" ("hour_timestamp","web_search_engine");