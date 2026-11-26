ALTER TABLE "notification_preference" ADD COLUMN "issue_window_minutes" integer DEFAULT 15 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD COLUMN "issue_error_rate_percent" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD COLUMN "issue_usage_hours" integer DEFAULT 4 NOT NULL;