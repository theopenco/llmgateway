-- A carrier delist used to hand a static-mapped pair back to the catalogue.
-- Take the pairs a carrier delisted itself, and still holds the claim for,
-- out of service again, the way a delist leaves them now.
UPDATE "model_provider_mapping" AS m
SET "source" = 'airside', "status" = 'inactive'
WHERE m."source" = 'catalogue' AND m."region" IS NULL AND EXISTS (
	SELECT 1
	FROM "provider_draft_model" d
	INNER JOIN "provider_claim" c
		ON c."provider_company_id" = d."provider_company_id"
		AND c."provider_id" = d."provider_id"
		AND c."status" = 'active'
	WHERE d."provider_id" = m."provider_id"
		AND d."model_name" = m."model_id"
		AND d."status" = 'delisted'
		AND d."delist_reason" = 'removed'
		-- Only the pair's latest listing decides.
		AND NOT EXISTS (
			SELECT 1
			FROM "provider_draft_model" later
			WHERE later."provider_id" = d."provider_id"
				AND later."model_name" = d."model_name"
				AND later."id" <> d."id"
				AND (later."status" <> 'delisted' OR later."delisted_at" > d."delisted_at")
		)
);--> statement-breakpoint
-- The listing owns every row of its pair: drop the restored regional variants.
DELETE FROM "model_provider_mapping" AS r
WHERE r."source" = 'catalogue' AND r."region" IS NOT NULL AND EXISTS (
	SELECT 1
	FROM "model_provider_mapping" root
	WHERE root."model_id" = r."model_id"
		AND root."provider_id" = r."provider_id"
		AND root."region" IS NULL
		AND root."source" = 'airside'
		AND root."status" = 'inactive'
);
