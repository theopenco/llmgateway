CREATE TABLE "playground_realtime_history" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"title" text NOT NULL,
	"model" text NOT NULL,
	"voice" text,
	"duration_seconds" integer DEFAULT 0 NOT NULL,
	"transcript" jsonb NOT NULL,
	"usage" jsonb
);
--> statement-breakpoint
CREATE TABLE "realtime_session" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"requested_model" text NOT NULL,
	"used_model" text NOT NULL,
	"used_model_mapping" text,
	"used_provider" text NOT NULL,
	"mode" text NOT NULL,
	"used_mode" text NOT NULL,
	"upstream_session_id" text,
	"status" text DEFAULT 'open' NOT NULL,
	"close_reason" text,
	"response_count" integer DEFAULT 0 NOT NULL,
	"total_cost" numeric DEFAULT '0' NOT NULL,
	"bytes_in" integer DEFAULT 0 NOT NULL,
	"bytes_out" integer DEFAULT 0 NOT NULL,
	"connected_at" timestamp DEFAULT now() NOT NULL,
	"closed_at" timestamp,
	"last_activity_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "api_key_hourly_model_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_model_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_source_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "realtime_session_id" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "realtime_usage_key" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "billing_cost" numeric;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "audio_output_tokens" numeric;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "audio_output_cost" real;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "realtime_usage" jsonb;--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_source_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "playground_realtime_history_user_id_idx" ON "playground_realtime_history" ("user_id");--> statement-breakpoint
CREATE INDEX "realtime_session_organization_id_created_at_idx" ON "realtime_session" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "realtime_session_project_id_created_at_idx" ON "realtime_session" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "realtime_session_api_key_id_created_at_idx" ON "realtime_session" ("api_key_id","created_at");--> statement-breakpoint
ALTER TABLE "playground_realtime_history" ADD CONSTRAINT "playground_realtime_history_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "playground_realtime_history" ADD CONSTRAINT "playground_realtime_history_6gba5Xye7cwi_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "realtime_session" ADD CONSTRAINT "realtime_session_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "realtime_session" ADD CONSTRAINT "realtime_session_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "realtime_session" ADD CONSTRAINT "realtime_session_api_key_id_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_key"("id") ON DELETE CASCADE;