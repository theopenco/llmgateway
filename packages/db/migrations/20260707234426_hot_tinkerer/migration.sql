ALTER TABLE "sso_provider" ADD COLUMN "domain_verified" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Existing connections were registered by org admins wiring up their own IdP;
-- treat them as verified so SAML sign-in (which now rejects unverified
-- providers) keeps working and first-login implicit account linking is trusted.
UPDATE "sso_provider" SET "domain_verified" = true;
--> statement-breakpoint
-- Drop the unusable account links SCIM provisioning used to pre-create with
-- the literal provider id "sso" (instead of the connection slug) and the SCIM
-- externalId (instead of the id the IdP asserts at SAML login). They can never
-- match a SAML sign-in; the correct link is created on first login instead.
-- Guarded in case an org's connection slug is literally "sso".
DELETE FROM "account"
WHERE "provider_id" = 'sso'
	AND NOT EXISTS (
		SELECT 1 FROM "sso_provider" WHERE "sso_provider"."provider_id" = 'sso'
	);