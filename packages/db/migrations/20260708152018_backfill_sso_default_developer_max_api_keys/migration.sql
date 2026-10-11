-- Backfill a reasonable default per-developer API key cap (3) for organizations
-- that already have an SSO connection but never configured their own default
-- developer budget. New SSO setups seed this at registration time; this covers
-- the handful of orgs provisioned before that seeding existed. Only NULL values
-- are touched so we never clobber an explicit admin choice.
UPDATE "organization"
SET "default_developer_max_api_keys" = 3
WHERE "default_developer_max_api_keys" IS NULL
	AND "id" IN (
		SELECT DISTINCT "organization_id"
		FROM "sso_provider"
		WHERE "organization_id" IS NOT NULL
	);
