ALTER TABLE "provider_key" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "variant" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "provider_key" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "provider_key_managed_provider_idx" ON "provider_key" ("managed","provider");--> statement-breakpoint
ALTER TABLE "provider_key" ADD CONSTRAINT "provider_key_managed_org_scope" CHECK (("managed" = true AND "organization_id" IS NULL) OR ("managed" = false AND "organization_id" IS NOT NULL));