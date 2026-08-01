ALTER TABLE "log" ADD COLUMN "session_id" text;--> statement-breakpoint
ALTER TABLE "routing_config" ADD COLUMN "session" jsonb;