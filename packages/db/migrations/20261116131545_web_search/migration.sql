-- migrate:reviewed Every ALTER is ADD COLUMN, nullable or with a constant default: catalog-only, no rewrite or scan, so the locks are held for milliseconds.
CREATE TABLE "project_hourly_web_search_stats" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"project_id" text NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"web_search_type" text NOT NULL,
	"web_search_engine" text NOT NULL,
	"used_provider" text NOT NULL,
	"used_mode" text NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"search_count" integer DEFAULT 0 NOT NULL,
	"web_search_cost" real DEFAULT 0 NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	CONSTRAINT "project_hourly_web_search_stats_unique" UNIQUE("project_id","hour_timestamp","web_search_type","web_search_engine","used_provider","used_mode")
);
--> statement-breakpoint
ALTER TABLE "api_key_hourly_model_stats" ADD COLUMN "web_search_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_hourly_source_stats" ADD COLUMN "web_search_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats" ADD COLUMN "web_search_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_hourly_model_stats" ADD COLUMN "web_search_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_hourly_provider_key_model_stats" ADD COLUMN "web_search_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_hourly_source_stats" ADD COLUMN "web_search_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_model_stats" ADD COLUMN "web_search_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_provider_key_model_stats" ADD COLUMN "web_search_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_source_stats" ADD COLUMN "web_search_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "web_search_engine" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "web_search_type" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "web_search_count" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "web_search_engine" text;--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" ADD COLUMN "web_search_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_source_stats" ADD COLUMN "web_search_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_stats" ADD COLUMN "web_search_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "project_hourly_web_search_stats_project_id_hour_timestamp_idx" ON "project_hourly_web_search_stats" ("project_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "project_hourly_web_search_stats_hour_timestamp_engine_idx" ON "project_hourly_web_search_stats" ("hour_timestamp","web_search_type","web_search_engine");