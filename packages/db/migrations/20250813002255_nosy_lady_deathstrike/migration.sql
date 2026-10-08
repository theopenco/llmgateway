ALTER TABLE "log" ADD COLUMN "processed_at" timestamp;

CREATE INDEX log_processed_at_null_idx ON log (created_at) WHERE processed_at IS NULL;

-- Set all existing logs as processed since they would have been processed by the old system
UPDATE "log" SET "processed_at" = "created_at" WHERE "processed_at" IS NULL;
