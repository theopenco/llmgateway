ALTER TABLE "log" ADD COLUMN "retried" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "retried_by_log_id" text;