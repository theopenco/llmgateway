CREATE TABLE "project_hourly_routing_stats" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"project_id" text NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"route_key" text NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"input_tokens" numeric DEFAULT '0' NOT NULL,
	"output_tokens" numeric DEFAULT '0' NOT NULL,
	"cached_tokens" numeric DEFAULT '0' NOT NULL,
	"cost" real DEFAULT 0 NOT NULL,
	"baseline_cost" real DEFAULT 0 NOT NULL,
	CONSTRAINT "project_hourly_routing_stats_project_id_hour_timestamp_route_key_unique" UNIQUE("project_id","hour_timestamp","route_key")
);
--> statement-breakpoint
ALTER TABLE "global_aggregation_state" ADD COLUMN "target_hour" timestamp;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "routing_baseline_model" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "routing_baseline_cost" real;--> statement-breakpoint
CREATE INDEX "project_hourly_routing_stats_project_id_hour_timestamp_idx" ON "project_hourly_routing_stats" ("project_id","hour_timestamp");