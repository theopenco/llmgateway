-- Seed SCX's two Airside claims with their reviewed catalogue profile, endpoint,
-- data policy and certifications, so they serve on their own once the static
-- provider definitions are removed. Values the carrier already set are kept.
UPDATE "provider_claim"
SET
	"custom_name" = COALESCE("custom_name", CASE "provider_id" WHEN 'scx-ai' THEN 'SCX.ai (Turbo)' ELSE 'SCX.ai' END),
	"custom_base_url" = COALESCE("custom_base_url", 'https://api.scx.ai'),
	"custom_description" = COALESCE("custom_description", CASE "provider_id"
		WHEN 'scx-ai' THEN 'SCX.ai is an Australian sovereign AI platform providing OpenAI-compatible Turbo inference endpoints — up to 4x faster than comparable providers — for a range of open models and SCX''s own models, hosted on renewable-powered infrastructure.'
		ELSE 'SCX.ai is an Australian sovereign AI platform providing OpenAI-compatible general-purpose inference endpoints for a range of open models and SCX''s own models, hosted on renewable-powered infrastructure.'
	END),
	"website" = COALESCE("website", 'https://scx.ai'),
	"terms_url" = COALESCE("terms_url", 'https://scx.ai/terms'),
	"privacy_policy_url" = COALESCE("privacy_policy_url", 'https://scx.ai/privacy'),
	"legal_entity" = COALESCE("legal_entity", 'SCX.ai Holdings Limited'),
	"headquarters" = COALESCE("headquarters", 'AU'),
	"api_training" = COALESCE("api_training", false),
	"prompt_logging" = COALESCE("prompt_logging", false),
	"retention_period" = COALESCE("retention_period", '0 days'),
	"soc2" = COALESCE("soc2", 1),
	"iso27001" = COALESCE("iso27001", true),
	"profile_updated_at" = COALESCE("profile_updated_at", now())
WHERE "provider_id" IN ('scx-ai', 'scx-ai-gp') AND "kind" = 'catalogue' AND "status" = 'active';
