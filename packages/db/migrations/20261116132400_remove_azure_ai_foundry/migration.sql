-- The azure-ai-foundry catalogue provider is removed. Hide its synced rows and
-- drop the id from saved provider lists. Allow-style lists keep it when it is
-- their only entry, since emptying them would allow every provider.
UPDATE "provider" SET "status" = 'inactive' WHERE "id" = 'azure-ai-foundry';
--> statement-breakpoint
UPDATE "model_provider_mapping" SET "status" = 'inactive'
WHERE "provider_id" = 'azure-ai-foundry' AND "status" = 'active';
--> statement-breakpoint
UPDATE "organization"
SET "provider_access_restriction" = jsonb_set(
	"provider_access_restriction"::jsonb,
	'{providers}',
	("provider_access_restriction"::jsonb -> 'providers') - 'azure-ai-foundry'
)::json
WHERE "provider_access_restriction"::jsonb -> 'providers' ? 'azure-ai-foundry'
	AND jsonb_array_length("provider_access_restriction"::jsonb -> 'providers')
		+ jsonb_array_length(coalesce("provider_access_restriction"::jsonb -> 'models', '[]'))
		+ jsonb_array_length(coalesce("provider_access_restriction"::jsonb -> 'mappings', '[]')) > 1;
--> statement-breakpoint
UPDATE "organization"
SET "provider_compliance_policy" = jsonb_set(
	"provider_compliance_policy"::jsonb,
	'{blockedProviders}',
	("provider_compliance_policy"::jsonb -> 'blockedProviders') - 'azure-ai-foundry'
)::json
WHERE "provider_compliance_policy"::jsonb -> 'blockedProviders' ? 'azure-ai-foundry';
--> statement-breakpoint
UPDATE "organization"
SET "provider_compliance_policy" = jsonb_set(
	"provider_compliance_policy"::jsonb,
	'{allowedProviders}',
	("provider_compliance_policy"::jsonb -> 'allowedProviders') - 'azure-ai-foundry'
)::json
WHERE "provider_compliance_policy"::jsonb -> 'allowedProviders' ? 'azure-ai-foundry'
	AND jsonb_array_length("provider_compliance_policy"::jsonb -> 'allowedProviders') > 1;
--> statement-breakpoint
UPDATE "api_key"
SET "provider_compliance_policy" = jsonb_set(
	"provider_compliance_policy"::jsonb,
	'{blockedProviders}',
	("provider_compliance_policy"::jsonb -> 'blockedProviders') - 'azure-ai-foundry'
)::json
WHERE "provider_compliance_policy"::jsonb -> 'blockedProviders' ? 'azure-ai-foundry';
--> statement-breakpoint
UPDATE "api_key"
SET "provider_compliance_policy" = jsonb_set(
	"provider_compliance_policy"::jsonb,
	'{allowedProviders}',
	("provider_compliance_policy"::jsonb -> 'allowedProviders') - 'azure-ai-foundry'
)::json
WHERE "provider_compliance_policy"::jsonb -> 'allowedProviders' ? 'azure-ai-foundry'
	AND jsonb_array_length("provider_compliance_policy"::jsonb -> 'allowedProviders') > 1;
--> statement-breakpoint
UPDATE "api_key_iam_rule"
SET "rule_value" = jsonb_set("rule_value"::jsonb, '{providers}', ("rule_value"::jsonb -> 'providers') - 'azure-ai-foundry')::json
WHERE "rule_value"::jsonb -> 'providers' ? 'azure-ai-foundry'
	AND jsonb_array_length("rule_value"::jsonb -> 'providers') > 1;
--> statement-breakpoint
UPDATE "user_iam_rule"
SET "rule_value" = jsonb_set("rule_value"::jsonb, '{providers}', ("rule_value"::jsonb -> 'providers') - 'azure-ai-foundry')::json
WHERE "rule_value"::jsonb -> 'providers' ? 'azure-ai-foundry'
	AND jsonb_array_length("rule_value"::jsonb -> 'providers') > 1;
--> statement-breakpoint
UPDATE "organization_team_iam_rule"
SET "rule_value" = jsonb_set("rule_value"::jsonb, '{providers}', ("rule_value"::jsonb -> 'providers') - 'azure-ai-foundry')::json
WHERE "rule_value"::jsonb -> 'providers' ? 'azure-ai-foundry'
	AND jsonb_array_length("rule_value"::jsonb -> 'providers') > 1;
--> statement-breakpoint
UPDATE "provider_key"
SET "options" = "options" - 'azure_ai_foundry_resource' - 'azure_ai_foundry_api_version'
WHERE "options" ?| array['azure_ai_foundry_resource', 'azure_ai_foundry_api_version'];
