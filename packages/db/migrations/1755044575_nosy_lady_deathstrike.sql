ALTER TABLE "log" ADD COLUMN "processed_at" timestamp;

-- Set all existing logs as processed since they would have been processed by the old system
UPDATE "log" SET "processed_at" = "created_at" WHERE "processed_at" IS NULL;
