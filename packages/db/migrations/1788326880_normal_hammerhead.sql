ALTER TABLE "model_provider_mapping" ADD COLUMN "source" text DEFAULT 'catalogue' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "audio" boolean;--> statement-breakpoint
CREATE INDEX "model_provider_mapping_source_status_idx" ON "model_provider_mapping" ("source","status");--> statement-breakpoint
INSERT INTO "provider" ("id", "name", "description")
SELECT DISTINCT
	"draft"."provider_id",
	COALESCE("company"."name", "draft"."provider_id"),
	''
FROM "provider_draft_model" AS "draft"
INNER JOIN "provider_company" AS "company"
	ON "company"."id" = "draft"."provider_company_id"
WHERE "draft"."status" = 'active'
	AND EXISTS (
		SELECT 1
		FROM "provider_price_filing" AS "filing"
		WHERE "filing"."draft_model_id" = "draft"."id"
			AND "filing"."status" = 'approved'
	)
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
INSERT INTO "model" ("id", "name", "description", "family", "status")
SELECT DISTINCT ON ("draft"."model_name")
	"draft"."model_name",
	COALESCE("draft"."display_name", "draft"."model_name"),
	COALESCE("draft"."description", ''),
	COALESCE("draft"."family", "draft"."provider_id"),
	'active'
FROM "provider_draft_model" AS "draft"
WHERE "draft"."status" = 'active'
	AND EXISTS (
		SELECT 1
		FROM "provider_price_filing" AS "filing"
		WHERE "filing"."draft_model_id" = "draft"."id"
			AND "filing"."status" = 'approved'
	)
ORDER BY "draft"."model_name", "draft"."updated_at" DESC
ON CONFLICT ("id") DO NOTHING;--> statement-breakpoint
WITH "latest_draft" AS (
	SELECT DISTINCT ON ("model_name") "model_name", "family", "provider_id"
	FROM "provider_draft_model"
	WHERE "status" = 'active'
	ORDER BY "model_name", "updated_at" DESC, "id" DESC
)
UPDATE "model" AS "model"
SET "family" = COALESCE("latest_draft"."family", "latest_draft"."provider_id")
FROM "latest_draft"
WHERE "model"."id" = "latest_draft"."model_name"
	AND "model"."family" = 'airside';--> statement-breakpoint
WITH "approved_listing" AS (
	SELECT DISTINCT ON ("draft"."provider_id", "draft"."model_name")
		"draft".*,
		"filing"."input_price" AS "filing_input_price",
		"filing"."output_price" AS "filing_output_price",
		"filing"."cached_input_price" AS "filing_cached_input_price",
		"filing"."request_price" AS "filing_request_price"
	FROM "provider_draft_model" AS "draft"
	INNER JOIN "provider_price_filing" AS "filing"
		ON "filing"."draft_model_id" = "draft"."id"
		AND "filing"."status" = 'approved'
	WHERE "draft"."status" = 'active'
	ORDER BY
		"draft"."provider_id",
		"draft"."model_name",
		"filing"."created_at" DESC
)
UPDATE "model_provider_mapping" AS "mapping"
SET
	"source" = 'airside',
	"external_id" = CASE
		WHEN "mapping"."deactivated_at" <= NOW() THEN "listing"."model_name"
		ELSE "mapping"."external_id"
	END,
	"input_price" = "listing"."filing_input_price"::numeric,
	"output_price" = "listing"."filing_output_price"::numeric,
	"cached_input_price" = "listing"."filing_cached_input_price"::numeric,
	"request_price" = "listing"."filing_request_price"::numeric,
	"context_size" = "listing"."context_size",
	"max_output" = "listing"."max_output",
	"streaming" = "listing"."streaming",
	"vision" = "listing"."vision",
	"audio" = "listing"."audio",
	"tools" = "listing"."tools",
	"json_output" = "listing"."json_output",
	"reasoning" = "listing"."reasoning",
	"reasoning_efforts" = "listing"."reasoning_efforts"::json,
	"status" = 'active',
	"deactivated_at" = NULL,
	"updated_at" = NOW()
FROM "approved_listing" AS "listing"
WHERE "mapping"."model_id" = "listing"."model_name"
	AND "mapping"."provider_id" = "listing"."provider_id"
	AND "mapping"."region" IS NULL;--> statement-breakpoint
WITH "approved_listing" AS (
	SELECT DISTINCT ON ("draft"."provider_id", "draft"."model_name")
		"draft".*,
		"filing"."input_price" AS "filing_input_price",
		"filing"."output_price" AS "filing_output_price",
		"filing"."cached_input_price" AS "filing_cached_input_price",
		"filing"."request_price" AS "filing_request_price"
	FROM "provider_draft_model" AS "draft"
	INNER JOIN "provider_price_filing" AS "filing"
		ON "filing"."draft_model_id" = "draft"."id"
		AND "filing"."status" = 'approved'
	WHERE "draft"."status" = 'active'
	ORDER BY
		"draft"."provider_id",
		"draft"."model_name",
		"filing"."created_at" DESC
)
INSERT INTO "model_provider_mapping" (
	"id",
	"model_id",
	"provider_id",
	"external_id",
	"source",
	"input_price",
	"output_price",
	"cached_input_price",
	"request_price",
	"context_size",
	"max_output",
	"streaming",
	"vision",
	"audio",
	"tools",
	"json_output",
	"reasoning",
	"reasoning_efforts",
	"status"
)
SELECT
	'airside-backfill-' || MD5("listing"."provider_id" || ':' || "listing"."model_name"),
	"listing"."model_name",
	"listing"."provider_id",
	"listing"."model_name",
	'airside',
	"listing"."filing_input_price"::numeric,
	"listing"."filing_output_price"::numeric,
	"listing"."filing_cached_input_price"::numeric,
	"listing"."filing_request_price"::numeric,
	"listing"."context_size",
	"listing"."max_output",
	"listing"."streaming",
	"listing"."vision",
	"listing"."audio",
	"listing"."tools",
	"listing"."json_output",
	"listing"."reasoning",
	"listing"."reasoning_efforts"::json,
	'active'
FROM "approved_listing" AS "listing"
WHERE NOT EXISTS (
	SELECT 1
	FROM "model_provider_mapping" AS "mapping"
	WHERE "mapping"."model_id" = "listing"."model_name"
		AND "mapping"."provider_id" = "listing"."provider_id"
		AND "mapping"."region" IS NULL
);
