ALTER TABLE "provider_claim" ADD COLUMN "provider_key_id" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "pending_provider_key_id" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD CONSTRAINT "provider_claim_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("provider_key_id") REFERENCES "provider_key"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD CONSTRAINT "provider_claim_pending_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("pending_provider_key_id") REFERENCES "provider_key"("id") ON DELETE SET NULL;--> statement-breakpoint
-- Carriers live before this change were keyed by hand in admin: link each to
-- its newest active managed key so Settings shows it and an approved
-- replacement retires it.
UPDATE "provider_claim" AS c
SET "provider_key_id" = k."id"
FROM (
	SELECT DISTINCT ON ("provider") "id", "provider"
	FROM "provider_key"
	WHERE "managed" = true AND "status" = 'active' AND "organization_id" IS NULL
	ORDER BY "provider", "created_at" DESC
) AS k
WHERE c."kind" = 'custom' AND c."status" = 'active' AND c."provider_id" = k."provider";
