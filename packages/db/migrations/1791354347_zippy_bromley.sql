ALTER TABLE "provider_key" ADD COLUMN "carrier_submitted" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Keys filed in Airside always carried this comment.
UPDATE "provider_key"
SET "carrier_submitted" = true
WHERE "managed" = true AND "comment" = 'Submitted by the carrier in Airside';
