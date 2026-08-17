CREATE TABLE "provider_listing_test_run" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"listing_request_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"results" jsonb DEFAULT '[]' NOT NULL,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "provider_listing_request" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "provider_listing_request" ADD COLUMN "provider_slug" text;--> statement-breakpoint
ALTER TABLE "provider_listing_request" ADD COLUMN "base_url" text;--> statement-breakpoint
ALTER TABLE "provider_listing_request" ADD COLUMN "test_key_ciphertext" text;--> statement-breakpoint
ALTER TABLE "provider_listing_request" ADD COLUMN "test_key_masked" text;--> statement-breakpoint
ALTER TABLE "provider_listing_request" ADD COLUMN "claimed_models" jsonb;--> statement-breakpoint
ALTER TABLE "provider_listing_request" ADD COLUMN "discount_percent" numeric;--> statement-breakpoint
ALTER TABLE "provider_listing_request" ADD COLUMN "validation_status" text DEFAULT 'not_started' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_listing_request" ADD COLUMN "listed_at" timestamp;--> statement-breakpoint
CREATE INDEX "provider_listing_request_organization_id_idx" ON "provider_listing_request" ("organization_id");--> statement-breakpoint
CREATE INDEX "provider_listing_test_run_listing_request_id_idx" ON "provider_listing_test_run" ("listing_request_id");--> statement-breakpoint
CREATE INDEX "provider_listing_test_run_queued_idx" ON "provider_listing_test_run" ("created_at") WHERE "status" = 'queued';--> statement-breakpoint
ALTER TABLE "provider_listing_request" ADD CONSTRAINT "provider_listing_request_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_listing_test_run" ADD CONSTRAINT "provider_listing_test_run_uoZuc9vqlCsF_fkey" FOREIGN KEY ("listing_request_id") REFERENCES "provider_listing_request"("id") ON DELETE CASCADE;