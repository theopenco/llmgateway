CREATE INDEX IF NOT EXISTS "log_processed_at_null_idx" ON "log" ("created_at") WHERE processed_at IS NULL;
