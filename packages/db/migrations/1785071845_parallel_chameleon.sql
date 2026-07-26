ALTER TABLE "api_key" ADD COLUMN "kind" text;--> statement-breakpoint
-- Platform-managed playground keys used to be identified by matching their
-- description against the fixed string the API wrote at creation time. Flag the
-- existing ones so the guards can key on `kind` instead.
UPDATE "api_key" SET "kind" = 'playground' WHERE "description" = 'Auto-generated playground key';--> statement-breakpoint
-- With the flag in place the description is a plain label again, so it can carry
-- the Lounge name that every surface already shows for these keys.
UPDATE "api_key" SET "description" = 'Auto-generated Lounge key' WHERE "kind" = 'playground';
