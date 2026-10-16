-- The volatile default makes the inline ADD COLUMN rewrite "api_key" under an
-- ACCESS EXCLUSIVE lock, stalling API-key lookups for its duration. On a large
-- table, prepare it out of band BEFORE deploying this migration (psql,
-- autocommit; CONCURRENTLY cannot run in a transaction):
--
--   ALTER TABLE "api_key" ADD COLUMN "safety_identifier" text;
--   ALTER TABLE "api_key" ALTER COLUMN "safety_identifier" SET DEFAULT 'key_' || replace(gen_random_uuid()::text, '-', '');
--   -- repeat until it updates 0 rows:
--   UPDATE "api_key" SET "safety_identifier" = DEFAULT WHERE "id" IN (SELECT "id" FROM "api_key" WHERE "safety_identifier" IS NULL LIMIT 5000);
--   CREATE UNIQUE INDEX CONCURRENTLY "api_key_safety_identifier_uidx" ON "api_key" ("safety_identifier");
--
-- Then check pg_index.indisvalid; drop an INVALID index CONCURRENTLY and retry.
-- The statements below adopt that prepared column and index, leaving only the
-- NOT NULL scan; fresh databases (dev, CI, self-hosted) build everything inline.
ALTER TABLE "api_key" ADD COLUMN IF NOT EXISTS "safety_identifier" text DEFAULT 'key_' || replace(gen_random_uuid()::text, '-', '') NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "safety_identifier" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_key_safety_identifier_uidx" ON "api_key" ("safety_identifier");