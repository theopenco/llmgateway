ALTER TABLE "provider_key" ADD COLUMN "max_rpm" integer;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "max_rpd" integer;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "max_tpm" integer;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "max_tpd" integer;--> statement-breakpoint
ALTER TABLE "rate_limit" ADD COLUMN "max_tpm" integer;--> statement-breakpoint
ALTER TABLE "rate_limit" ADD COLUMN "max_tpd" integer;--> statement-breakpoint
DROP INDEX "rate_limit_org_provider_model_unique";--> statement-breakpoint
CREATE UNIQUE INDEX "rate_limit_org_provider_model_unique" ON "rate_limit" (coalesce("organization_id", '__global__'),coalesce("provider", '__all_providers__'),coalesce("model", '__all_models__'),(case when "max_rpm" is not null then 'rpm' when "max_rpd" is not null then 'rpd' when "max_tpm" is not null then 'tpm' when "max_tpd" is not null then 'tpd' end));