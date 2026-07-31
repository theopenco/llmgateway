ALTER TABLE "provider_key" ADD COLUMN "token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "token_masked" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "managed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "comment" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "variant" text DEFAULT 'default' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "sort_order" integer;--> statement-breakpoint
ALTER TABLE "video_job" ADD COLUMN "managed_provider_key_id" text;--> statement-breakpoint
ALTER TABLE "provider_key" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ALTER COLUMN "organization_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "provider_key_sort_order_idx" ON "provider_key" ("organization_id","provider","sort_order");--> statement-breakpoint
CREATE INDEX "provider_key_managed_provider_idx" ON "provider_key" ("managed","provider");--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_managed_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("managed_provider_key_id") REFERENCES "provider_key"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ADD CONSTRAINT "provider_key_token_xor" CHECK ("token" IS NULL OR "token_ciphertext" IS NULL);--> statement-breakpoint
ALTER TABLE "provider_key" ADD CONSTRAINT "provider_key_managed_org_scope" CHECK (("managed" = true AND "organization_id" IS NULL) OR ("managed" = false AND "organization_id" IS NOT NULL));