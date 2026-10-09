DROP INDEX "provider_company_domain_company_domain_uidx";--> statement-breakpoint
ALTER TABLE "provider_company_domain" ADD COLUMN "verification_method" text DEFAULT 'dns' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_company_domain_company_domain_method_uidx" ON "provider_company_domain" ("provider_company_id","domain","verification_method");--> statement-breakpoint
-- Record the domains existing claims were matched on through the claimer's
-- email domain.
INSERT INTO "provider_company_domain" ("id", "provider_company_id", "domain", "verification_method", "verified_at")
SELECT gen_random_uuid()::text, c."provider_company_id", c."matched_domain", 'email', min(c."created_at")
FROM "provider_claim" c
JOIN "user" u ON u."id" = c."claimed_by"
WHERE c."status" <> 'revoked'
	AND (
		lower(split_part(u."email", '@', 2)) = c."matched_domain"
		OR right(lower(split_part(u."email", '@', 2)), length(c."matched_domain") + 1) = '.' || c."matched_domain"
	)
GROUP BY c."provider_company_id", c."matched_domain";
