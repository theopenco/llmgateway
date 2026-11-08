CREATE TABLE "batch" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text,
	"endpoint" text NOT NULL,
	"input_file_id" text NOT NULL,
	"completion_window" text DEFAULT '24h' NOT NULL,
	"status" text DEFAULT 'validating' NOT NULL,
	"metadata" jsonb,
	"errors" jsonb,
	"output_file_id" text,
	"error_file_id" text,
	"request_total" integer DEFAULT 0 NOT NULL,
	"request_completed" integer DEFAULT 0 NOT NULL,
	"request_failed" integer DEFAULT 0 NOT NULL,
	"client_ip" text,
	"claimed_until" timestamp,
	"in_progress_at" timestamp,
	"finalizing_at" timestamp,
	"completed_at" timestamp,
	"failed_at" timestamp,
	"expired_at" timestamp,
	"cancelling_at" timestamp,
	"cancelled_at" timestamp,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_credential" (
	"batch_id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"api_key_id" text NOT NULL,
	"encrypted_token" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_file" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"api_key_id" text,
	"purpose" text NOT NULL,
	"filename" text NOT NULL,
	"bytes" integer NOT NULL,
	"content" text,
	"batch_id" text,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "batch_request" (
	"id" text PRIMARY KEY,
	"batch_id" text NOT NULL,
	"line_number" integer NOT NULL,
	"custom_id" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"claimed_until" timestamp,
	"response_status" integer,
	"response_body" text,
	"request_id" text,
	"error" jsonb,
	"completed_at" timestamp,
	CONSTRAINT "batch_request_batch_id_custom_id_unique" UNIQUE("batch_id","custom_id")
);
--> statement-breakpoint
CREATE INDEX "batch_project_id_created_at_idx" ON "batch" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "batch_active_status_idx" ON "batch" ("status") WHERE "status" in ('validating', 'in_progress', 'finalizing', 'cancelling');--> statement-breakpoint
CREATE INDEX "batch_file_project_id_created_at_idx" ON "batch_file" ("project_id","created_at");--> statement-breakpoint
CREATE INDEX "batch_file_expires_at_idx" ON "batch_file" ("expires_at");--> statement-breakpoint
CREATE INDEX "batch_request_batch_id_line_number_idx" ON "batch_request" ("batch_id","line_number");--> statement-breakpoint
CREATE INDEX "batch_request_pending_idx" ON "batch_request" ("batch_id","next_attempt_at") WHERE "status" = 'pending';--> statement-breakpoint
CREATE INDEX "batch_request_in_progress_idx" ON "batch_request" ("claimed_until") WHERE "status" = 'in_progress';--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "batch" ADD CONSTRAINT "batch_api_key_id_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_key"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "batch_credential" ADD CONSTRAINT "batch_credential_batch_id_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "batch_credential" ADD CONSTRAINT "batch_credential_api_key_id_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_key"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "batch_file" ADD CONSTRAINT "batch_file_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "batch_file" ADD CONSTRAINT "batch_file_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "batch_file" ADD CONSTRAINT "batch_file_api_key_id_api_key_id_fkey" FOREIGN KEY ("api_key_id") REFERENCES "api_key"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "batch_request" ADD CONSTRAINT "batch_request_batch_id_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "batch"("id") ON DELETE CASCADE;