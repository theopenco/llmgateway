ALTER TABLE "provider_key" ADD COLUMN "max_rpm" integer;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "max_rpd" integer;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "max_tpm" integer;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "max_tpd" integer;--> statement-breakpoint
ALTER TABLE "rate_limit" ADD COLUMN "max_tpm" integer;--> statement-breakpoint
ALTER TABLE "rate_limit" ADD COLUMN "max_tpd" integer;