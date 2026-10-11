CREATE TABLE "video_job" (
	"id" text PRIMARY KEY,
	"request_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text NOT NULL,
	"mode" text NOT NULL,
	"used_mode" text NOT NULL,
	"model" text NOT NULL,
	"requested_provider" text,
	"used_provider" text NOT NULL,
	"used_model" text NOT NULL,
	"provider_config_index" integer,
	"upstream_id" text NOT NULL,
	"prompt" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error" jsonb,
	"content_url" text,
	"storage_provider" text,
	"storage_bucket" text,
	"storage_object_path" text,
	"storage_uri" text,
	"storage_expires_at" timestamp,
	"content_type" text,
	"completed_at" timestamp,
	"expires_at" timestamp,
	"last_polled_at" timestamp,
	"next_poll_at" timestamp DEFAULT now() NOT NULL,
	"poll_attempt_count" integer DEFAULT 0 NOT NULL,
	"callback_url" text,
	"callback_secret" text,
	"callback_status" text DEFAULT 'none' NOT NULL,
	"callback_event_id" text,
	"callback_event_type" text,
	"callback_delivered_at" timestamp,
	"result_logged_at" timestamp,
	"routing_metadata" jsonb,
	"upstream_create_response" jsonb,
	"upstream_status_response" jsonb
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery_log" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"video_job_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"target_url" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_tried_at" timestamp,
	"next_retry_at" timestamp DEFAULT now() NOT NULL,
	"delivered_at" timestamp,
	"request_headers" jsonb,
	"request_body" jsonb,
	"response_status" integer,
	"response_body" text,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "api_key_hourly_model_stats" ADD COLUMN "video_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats" ADD COLUMN "video_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "video_output_cost" real;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "video_download_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "last_video_downloaded_at" timestamp;--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" ADD COLUMN "video_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_stats" ADD COLUMN "video_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "video_job_project_id_created_at_idx" ON "video_job" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "video_job_status_next_poll_at_idx" ON "video_job" ("status","next_poll_at");--> statement-breakpoint
CREATE INDEX "video_job_upstream_id_idx" ON "video_job" ("upstream_id");--> statement-breakpoint
CREATE INDEX "video_job_callback_status_idx" ON "video_job" ("callback_status");--> statement-breakpoint
CREATE INDEX "webhook_delivery_log_video_job_id_idx" ON "webhook_delivery_log" ("video_job_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_log_status_next_retry_at_idx" ON "webhook_delivery_log" ("status","next_retry_at");--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_api_key_id_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_key"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_delivery_log" ADD CONSTRAINT "webhook_delivery_log_video_job_id_video_job_id_fkey" FOREIGN KEY ("video_job_id") REFERENCES "video_job"("id") ON DELETE CASCADE;