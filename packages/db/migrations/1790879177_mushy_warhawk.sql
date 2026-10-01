CREATE TABLE "provider_company_domain" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_company_id" text NOT NULL,
	"domain" text NOT NULL,
	"verified_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_company_domain_company_domain_uidx" ON "provider_company_domain" ("provider_company_id","domain");--> statement-breakpoint
ALTER TABLE "provider_company_domain" ADD CONSTRAINT "provider_company_domain_T6DSYYYQDSoO_fkey" FOREIGN KEY ("provider_company_id") REFERENCES "provider_company"("id") ON DELETE CASCADE;