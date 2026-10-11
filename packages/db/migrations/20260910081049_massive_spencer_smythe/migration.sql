ALTER TABLE "provider_price_filing" ADD COLUMN "region_prices" jsonb;
--> statement-breakpoint
-- An approved Airside listing owns every mapping row of its (model, provider)
-- pair, but materialization historically only replaced the region-NULL row.
-- Drop leftover catalogue-sourced regional rows so cards and billing cannot
-- show stale regional prices next to the carrier's filed default pricing.
DELETE FROM "model_provider_mapping" AS "stale"
WHERE "stale"."source" = 'catalogue'
	AND "stale"."region" IS NOT NULL
	AND EXISTS (
		SELECT 1
		FROM "model_provider_mapping" AS "owner"
		WHERE "owner"."model_id" = "stale"."model_id"
			AND "owner"."provider_id" = "stale"."provider_id"
			AND "owner"."source" = 'airside'
	);
