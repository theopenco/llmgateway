CREATE TABLE "model_history_hourly" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"model_id" text NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"logs_count" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"client_errors_count" integer DEFAULT 0 NOT NULL,
	"gateway_errors_count" integer DEFAULT 0 NOT NULL,
	"upstream_errors_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"length_limit_count" integer DEFAULT 0 NOT NULL,
	"content_filter_count" integer DEFAULT 0 NOT NULL,
	"tool_calls_count" integer DEFAULT 0 NOT NULL,
	"canceled_count" integer DEFAULT 0 NOT NULL,
	"unknown_finish_count" integer DEFAULT 0 NOT NULL,
	"cached_count" integer DEFAULT 0 NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"total_cached_tokens" integer DEFAULT 0 NOT NULL,
	"total_duration" integer DEFAULT 0 NOT NULL,
	"total_time_to_first_token" integer DEFAULT 0 NOT NULL,
	"total_time_to_first_reasoning_token" integer DEFAULT 0 NOT NULL,
	"total_cost" real DEFAULT 0 NOT NULL,
	CONSTRAINT "model_history_hourly_model_id_hour_timestamp_unique" UNIQUE("model_id","hour_timestamp")
);
--> statement-breakpoint
CREATE TABLE "model_provider_mapping_history_hourly" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"model_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_provider_mapping_id" text NOT NULL,
	"hour_timestamp" timestamp NOT NULL,
	"logs_count" integer DEFAULT 0 NOT NULL,
	"errors_count" integer DEFAULT 0 NOT NULL,
	"client_errors_count" integer DEFAULT 0 NOT NULL,
	"gateway_errors_count" integer DEFAULT 0 NOT NULL,
	"upstream_errors_count" integer DEFAULT 0 NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"length_limit_count" integer DEFAULT 0 NOT NULL,
	"content_filter_count" integer DEFAULT 0 NOT NULL,
	"tool_calls_count" integer DEFAULT 0 NOT NULL,
	"canceled_count" integer DEFAULT 0 NOT NULL,
	"unknown_finish_count" integer DEFAULT 0 NOT NULL,
	"cached_count" integer DEFAULT 0 NOT NULL,
	"total_input_tokens" integer DEFAULT 0 NOT NULL,
	"total_output_tokens" integer DEFAULT 0 NOT NULL,
	"total_tokens" integer DEFAULT 0 NOT NULL,
	"total_reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"total_cached_tokens" integer DEFAULT 0 NOT NULL,
	"total_duration" integer DEFAULT 0 NOT NULL,
	"total_time_to_first_token" integer DEFAULT 0 NOT NULL,
	"total_time_to_first_reasoning_token" integer DEFAULT 0 NOT NULL,
	"total_cost" real DEFAULT 0 NOT NULL,
	CONSTRAINT "model_provider_mapping_history_hourly_model_provider_mapping_id_hour_timestamp_unique" UNIQUE("model_provider_mapping_id","hour_timestamp")
);
--> statement-breakpoint
CREATE INDEX "model_history_hourly_ts_idx" ON "model_history_hourly" ("hour_timestamp");--> statement-breakpoint
CREATE INDEX "model_history_hourly_model_ts_idx" ON "model_history_hourly" ("model_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "mpm_history_hourly_ts_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp");--> statement-breakpoint
CREATE INDEX "mpm_history_hourly_ts_provider_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp","provider_id");--> statement-breakpoint
CREATE INDEX "mpm_history_hourly_ts_model_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp","model_id");--> statement-breakpoint
CREATE INDEX "mpm_history_hourly_model_ts_idx" ON "model_provider_mapping_history_hourly" ("model_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX "mpm_history_hourly_provider_stats_idx" ON "model_provider_mapping_history_hourly" ("hour_timestamp","provider_id","logs_count","errors_count","cached_count","total_time_to_first_token","total_output_tokens","total_duration");