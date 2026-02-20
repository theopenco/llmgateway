DROP INDEX "log_data_retention_pending_idx";--> statement-breakpoint
CREATE INDEX "log_data_retention_pending_idx" ON "log" ("created_at") WHERE data_retention_cleaned_up = false;