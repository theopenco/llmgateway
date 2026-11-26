-- migrate:allow-blocking-index
-- migrate:contract #5152
DROP INDEX IF EXISTS "api_key_safety_identifier_uidx";--> statement-breakpoint
-- migrate:contract #5152
ALTER TABLE "api_key" DROP COLUMN "safety_identifier";