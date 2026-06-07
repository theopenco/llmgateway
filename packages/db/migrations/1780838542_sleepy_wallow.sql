CREATE TABLE "end_user_session" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"token" text NOT NULL UNIQUE,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"end_customer_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	"created_by" text NOT NULL,
	"scope" json,
	"usage_limit" numeric,
	"usage" numeric DEFAULT '0' NOT NULL,
	"period_usage_limit" numeric,
	"period_usage_duration_value" integer,
	"period_usage_duration_unit" text,
	"current_period_usage" numeric DEFAULT '0' NOT NULL,
	"current_period_started_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "end_user_session_id" text;--> statement-breakpoint
ALTER TABLE "video_job" ADD COLUMN "end_user_session_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_project_end_user_sessions_unique" ON "api_key" ("project_id") WHERE "key_type" = 'end_user_sessions';--> statement-breakpoint
CREATE INDEX "end_user_session_project_id_idx" ON "end_user_session" ("project_id");--> statement-breakpoint
CREATE INDEX "end_user_session_wallet_id_idx" ON "end_user_session" ("wallet_id");--> statement-breakpoint
CREATE INDEX "end_user_session_status_expires_at_idx" ON "end_user_session" ("status","expires_at");--> statement-breakpoint
CREATE INDEX "log_end_user_session_id_idx" ON "log" ("end_user_session_id","created_at") WHERE end_user_session_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "video_job_end_user_session_id_idx" ON "video_job" ("end_user_session_id");--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_end_customer_id_end_customer_id_fkey" FOREIGN KEY ("end_customer_id") REFERENCES "end_customer"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_wallet_id_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "log" ADD CONSTRAINT "log_end_user_session_id_end_user_session_id_fkey" FOREIGN KEY ("end_user_session_id") REFERENCES "end_user_session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_end_user_session_id_end_user_session_id_fkey" FOREIGN KEY ("end_user_session_id") REFERENCES "end_user_session"("id") ON DELETE SET NULL;