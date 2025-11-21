DROP INDEX "log_organization_id_created_at_idx";--> statement-breakpoint
DROP INDEX "log_data_retention_pending_idx";--> statement-breakpoint
CREATE INDEX "log_data_retention_pending_idx" ON "log" ("data_retention_cleaned_up","created_at") WHERE data_retention_cleaned_up = false;