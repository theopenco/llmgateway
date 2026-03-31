CREATE TABLE "rate_limit" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text,
	"provider" text,
	"model" text,
	"max_rpm" integer,
	"max_rpd" integer,
	"reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_org_provider_model_unique" ON "rate_limit" (coalesce("organization_id", '__global__'),coalesce("provider", '__all_providers__'),coalesce("model", '__all_models__'));--> statement-breakpoint
CREATE INDEX "rate_limit_organization_id_idx" ON "rate_limit" ("organization_id");--> statement-breakpoint
CREATE INDEX "rate_limit_provider_idx" ON "rate_limit" ("provider");--> statement-breakpoint
CREATE INDEX "rate_limit_model_idx" ON "rate_limit" ("model");--> statement-breakpoint
ALTER TABLE "rate_limit" ADD CONSTRAINT "rate_limit_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;