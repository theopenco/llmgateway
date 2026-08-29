CREATE TABLE "provider_claim" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_company_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"kind" text DEFAULT 'catalogue' NOT NULL,
	"matched_domain" text NOT NULL,
	"custom_name" text,
	"custom_base_url" text,
	"custom_description" text,
	"logo_url" text,
	"icon_url" text,
	"claimed_by" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"review_note" text,
	"reviewed_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "provider_company" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"website_verification_token" text,
	"website_verified_domain" text,
	"website_verified_at" timestamp,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"stripe_checkout_session_id" text,
	"paid_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "provider_company_member" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_company_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'owner' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_draft_model" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_company_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"model_name" text NOT NULL,
	"display_name" text,
	"description" text,
	"family" text,
	"context_size" integer,
	"max_output" integer,
	"streaming" boolean DEFAULT true NOT NULL,
	"vision" boolean DEFAULT false NOT NULL,
	"audio" boolean DEFAULT false NOT NULL,
	"tools" boolean DEFAULT false NOT NULL,
	"json_output" boolean DEFAULT false NOT NULL,
	"reasoning" boolean DEFAULT false NOT NULL,
	"reasoning_efforts" jsonb,
	"max_rpm" integer,
	"max_rpd" integer,
	"rate_limit_scope" text DEFAULT 'global' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" text,
	"delisted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "provider_price_filing" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"draft_model_id" text NOT NULL,
	"provider_company_id" text NOT NULL,
	"kind" text DEFAULT 'update' NOT NULL,
	"input_price" text NOT NULL,
	"output_price" text NOT NULL,
	"cached_input_price" text,
	"request_price" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text,
	"note" text,
	"reviewed_by" text,
	"review_note" text,
	"reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "provider_routing_settings" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_company_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"discount_percent" numeric DEFAULT '0' NOT NULL,
	"margin_percent" numeric DEFAULT '0.2' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "reasoning_efforts" json;--> statement-breakpoint
CREATE UNIQUE INDEX "provider_claim_active_provider_uidx" ON "provider_claim" ("provider_id") WHERE status IN ('pending', 'active');--> statement-breakpoint
CREATE INDEX "provider_claim_company_idx" ON "provider_claim" ("provider_company_id");--> statement-breakpoint
CREATE INDEX "provider_claim_status_idx" ON "provider_claim" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_company_member_company_user_uidx" ON "provider_company_member" ("provider_company_id","user_id");--> statement-breakpoint
CREATE INDEX "provider_company_member_user_idx" ON "provider_company_member" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_draft_model_provider_name_uidx" ON "provider_draft_model" ("provider_id","model_name") WHERE status <> 'delisted';--> statement-breakpoint
CREATE INDEX "provider_draft_model_company_idx" ON "provider_draft_model" ("provider_company_id");--> statement-breakpoint
CREATE INDEX "provider_draft_model_status_idx" ON "provider_draft_model" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_price_filing_pending_model_uidx" ON "provider_price_filing" ("draft_model_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "provider_price_filing_company_idx" ON "provider_price_filing" ("provider_company_id");--> statement-breakpoint
CREATE INDEX "provider_price_filing_status_idx" ON "provider_price_filing" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_routing_settings_provider_uidx" ON "provider_routing_settings" ("provider_id");--> statement-breakpoint
CREATE INDEX "provider_routing_settings_company_idx" ON "provider_routing_settings" ("provider_company_id");--> statement-breakpoint
ALTER TABLE "provider_claim" ADD CONSTRAINT "provider_claim_provider_company_id_provider_company_id_fkey" FOREIGN KEY ("provider_company_id") REFERENCES "provider_company"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD CONSTRAINT "provider_claim_claimed_by_user_id_fkey" FOREIGN KEY ("claimed_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_company_member" ADD CONSTRAINT "provider_company_member_PWLqZCVueoS2_fkey" FOREIGN KEY ("provider_company_id") REFERENCES "provider_company"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_company_member" ADD CONSTRAINT "provider_company_member_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD CONSTRAINT "provider_draft_model_K3fzWwAaPuBn_fkey" FOREIGN KEY ("provider_company_id") REFERENCES "provider_company"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD CONSTRAINT "provider_draft_model_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_price_filing" ADD CONSTRAINT "provider_price_filing_3KpVKQMcaf2d_fkey" FOREIGN KEY ("draft_model_id") REFERENCES "provider_draft_model"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_price_filing" ADD CONSTRAINT "provider_price_filing_YTYqXObd70kn_fkey" FOREIGN KEY ("provider_company_id") REFERENCES "provider_company"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_price_filing" ADD CONSTRAINT "provider_price_filing_requested_by_user_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_routing_settings" ADD CONSTRAINT "provider_routing_settings_7U6wrMahBViI_fkey" FOREIGN KEY ("provider_company_id") REFERENCES "provider_company"("id") ON DELETE CASCADE;