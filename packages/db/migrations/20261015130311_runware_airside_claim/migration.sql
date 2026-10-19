-- Seed Runware's Airside claim with its reviewed catalogue profile, endpoint
-- and data policy, so the claim can serve on its own once the static provider
-- definition is removed. Values the carrier already set are kept.
UPDATE "provider_claim"
SET
	"custom_name" = COALESCE("custom_name", 'Runware'),
	"custom_base_url" = COALESCE("custom_base_url", 'https://api.runware.ai'),
	"custom_description" = COALESCE("custom_description", 'Runware provides fast, cost-efficient inference for open and frontier LLMs through an OpenAI-compatible API.'),
	"website" = COALESCE("website", 'https://runware.ai'),
	"status_page_url" = COALESCE("status_page_url", 'https://status.runware.ai/'),
	"terms_url" = COALESCE("terms_url", 'https://runware.ai/terms'),
	"privacy_policy_url" = COALESCE("privacy_policy_url", 'https://runware.ai/privacy'),
	"legal_entity" = COALESCE("legal_entity", 'Runware Ltd'),
	"headquarters" = COALESCE("headquarters", 'GB'),
	"api_training" = COALESCE("api_training", false),
	"prompt_logging" = COALESCE("prompt_logging", false),
	"retention_period" = COALESCE("retention_period", '0 days'),
	"profile_updated_at" = COALESCE("profile_updated_at", now())
WHERE "provider_id" = 'runware' AND "kind" = 'catalogue' AND "status" = 'active';
