CREATE TABLE "airside_invite_code" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"code" text NOT NULL,
	"note" text,
	"max_uses" integer DEFAULT 1 NOT NULL,
	"used_count" integer DEFAULT 0 NOT NULL,
	"created_by" text,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "provider_company_invite" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_company_id" text NOT NULL,
	"email" text NOT NULL,
	"invited_by" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "provider_routing_filing" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_company_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"discount_percent" numeric NOT NULL,
	"margin_percent" numeric NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_by" text,
	"reviewed_by" text,
	"review_note" text,
	"reviewed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "provider_company" ADD COLUMN "listing_invite_code" text;--> statement-breakpoint
CREATE UNIQUE INDEX "airside_invite_code_code_uidx" ON "airside_invite_code" ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_company_invite_pending_uidx" ON "provider_company_invite" ("provider_company_id","email") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "provider_company_invite_email_idx" ON "provider_company_invite" ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_routing_filing_pending_provider_uidx" ON "provider_routing_filing" ("provider_id") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "provider_routing_filing_company_idx" ON "provider_routing_filing" ("provider_company_id");--> statement-breakpoint
CREATE INDEX "provider_routing_filing_status_idx" ON "provider_routing_filing" ("status");--> statement-breakpoint
ALTER TABLE "airside_invite_code" ADD CONSTRAINT "airside_invite_code_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_company_invite" ADD CONSTRAINT "provider_company_invite_N0qDajstUlSt_fkey" FOREIGN KEY ("provider_company_id") REFERENCES "provider_company"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_company_invite" ADD CONSTRAINT "provider_company_invite_invited_by_user_id_fkey" FOREIGN KEY ("invited_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_routing_filing" ADD CONSTRAINT "provider_routing_filing_7skPo0CbNHpK_fkey" FOREIGN KEY ("provider_company_id") REFERENCES "provider_company"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_routing_filing" ADD CONSTRAINT "provider_routing_filing_requested_by_user_id_fkey" FOREIGN KEY ("requested_by") REFERENCES "user"("id") ON DELETE SET NULL;