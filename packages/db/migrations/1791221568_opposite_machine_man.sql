CREATE TABLE "data_stream" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"destination" text NOT NULL,
	"config" jsonb DEFAULT '{}' NOT NULL,
	"secret" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"paused_reason" text,
	"cursor_created_at" timestamp DEFAULT now() NOT NULL,
	"cursor_id" text DEFAULT '' NOT NULL,
	"replay_from" timestamp,
	"replay_to" timestamp,
	"replay_cursor_created_at" timestamp,
	"replay_cursor_id" text,
	"delivered_count" bigint DEFAULT 0 NOT NULL,
	"last_delivered_at" timestamp,
	"last_error" text,
	"last_error_at" timestamp,
	"failure_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "data_streams_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "request_log_export_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "data_stream_organization_id_idx" ON "data_stream" ("organization_id");--> statement-breakpoint
ALTER TABLE "data_stream" ADD CONSTRAINT "data_stream_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "data_stream" ADD CONSTRAINT "data_stream_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;