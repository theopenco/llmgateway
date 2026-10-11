-- Phase 1 of a two-phase column rename: model_name -> external_id.
--
-- During the deploy window between this migration and the new code rolling
-- out, the previously running code still reads/writes model_name, so we keep
-- the legacy column around (with NOT NULL relaxed) instead of renaming it.
-- A follow-up PR will drop model_name once all callers are upgraded.
ALTER TABLE "model_provider_mapping" ADD COLUMN "external_id" text;--> statement-breakpoint
UPDATE "model_provider_mapping" SET "external_id" = "model_name" WHERE "external_id" IS NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ALTER COLUMN "external_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ALTER COLUMN "model_name" DROP NOT NULL;
