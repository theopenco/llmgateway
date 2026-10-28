-- Seed the Consensus Protocol and Gonka24 Airside claims with their reviewed
-- catalogue profile, endpoint and data policy, so they serve on their own once
-- the static provider definitions are removed. Consensus Protocol's claim also
-- links the managed credential that already serves its traffic. Values the
-- carrier already set are kept.
UPDATE "provider_claim"
SET
	"custom_name" = COALESCE("custom_name", 'Consensus Protocol'),
	"custom_base_url" = COALESCE("custom_base_url", 'https://api.consensusprotocol.org'),
	"custom_description" = COALESCE("custom_description", 'Consensus Protocol serves open-weight large language models on dedicated GPU hardware it operates, via an OpenAI-compatible inference API.'),
	"website" = COALESCE("website", 'https://consensusprotocol.org'),
	"terms_url" = COALESCE("terms_url", 'https://consensusprotocol.org/terms'),
	"privacy_policy_url" = COALESCE("privacy_policy_url", 'https://consensusprotocol.org/privacy'),
	"legal_entity" = COALESCE("legal_entity", 'Consensus Protocol LLC'),
	"headquarters" = COALESCE("headquarters", 'US'),
	"api_training" = COALESCE("api_training", false),
	"prompt_logging" = COALESCE("prompt_logging", false),
	"retention_period" = COALESCE("retention_period", '0 days'),
	"provider_key_id" = COALESCE("provider_key_id", (
		SELECT "id" FROM "provider_key"
		WHERE "provider" = 'consensusprotocol'
			AND "managed" = true
			AND "organization_id" IS NULL
			AND "status" = 'active'
		ORDER BY "created_at" DESC
		LIMIT 1
	)),
	"profile_updated_at" = COALESCE("profile_updated_at", now())
WHERE "provider_id" = 'consensusprotocol' AND "kind" = 'catalogue' AND "status" = 'active';
--> statement-breakpoint
UPDATE "provider_claim"
SET
	"custom_name" = COALESCE("custom_name", 'Gonka24'),
	"custom_base_url" = COALESCE("custom_base_url", 'https://api.gonka24.com'),
	"custom_description" = COALESCE("custom_description", 'Gonka24 serves open-weight large language models via an OpenAI-compatible inference gateway.'),
	"website" = COALESCE("website", 'https://gonka24.com'),
	"terms_url" = COALESCE("terms_url", 'https://gonka24.com/terms'),
	"privacy_policy_url" = COALESCE("privacy_policy_url", 'https://gonka24.com/privacy'),
	"legal_entity" = COALESCE("legal_entity", 'Investment company Temir LLC'),
	"headquarters" = COALESCE("headquarters", 'KZ'),
	"profile_updated_at" = COALESCE("profile_updated_at", now())
WHERE "provider_id" = 'gonka24' AND "kind" = 'catalogue' AND "status" = 'active';
