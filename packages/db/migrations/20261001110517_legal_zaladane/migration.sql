ALTER TABLE "provider_draft_model" ADD COLUMN "delist_reason" text;--> statement-breakpoint
-- A claim revocation delists the company's models in the same transaction
-- that stamps revoked_at; any other delisted row was removed by the carrier.
UPDATE "provider_draft_model" AS m
SET "delist_reason" = CASE
	WHEN EXISTS (
		SELECT 1 FROM "provider_claim" AS c
		WHERE c."provider_company_id" = m."provider_company_id"
			AND c."provider_id" = m."provider_id"
			AND c."status" = 'revoked'
			AND c."revoked_at" BETWEEN m."delisted_at" - interval '1 minute' AND m."delisted_at" + interval '1 minute'
	) THEN 'claim_revoked'
	ELSE 'removed'
END
WHERE m."status" = 'delisted';
