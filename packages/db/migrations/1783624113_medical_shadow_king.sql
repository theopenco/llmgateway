ALTER TABLE "organization" ADD COLUMN "sso_auto_join_domain" text;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_sso_auto_join_domain_uidx" ON "organization" ("sso_auto_join_domain");