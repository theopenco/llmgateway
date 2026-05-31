ALTER TABLE "log" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "routing_config" ADD COLUMN "session" jsonb;--> statement-breakpoint
CREATE INDEX "log_project_id_session_id_idx" ON "log" ("project_id","session_id","created_at") WHERE session_id IS NOT NULL;