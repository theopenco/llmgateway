CREATE TABLE "provider_certification" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_claim_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"certificate_number" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"attested" jsonb NOT NULL,
	"review_note" text,
	"issued_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"issued_by" text,
	"revoked_at" timestamp,
	"revoked_by" text,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_certification_number_uidx" ON "provider_certification" ("certificate_number");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_certification_active_provider_uidx" ON "provider_certification" ("provider_id") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "provider_certification_claim_idx" ON "provider_certification" ("provider_claim_id");--> statement-breakpoint
ALTER TABLE "provider_certification" ADD CONSTRAINT "provider_certification_provider_claim_id_provider_claim_id_fkey" FOREIGN KEY ("provider_claim_id") REFERENCES "provider_claim"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "provider_certification" ADD CONSTRAINT "provider_certification_issued_by_user_id_fkey" FOREIGN KEY ("issued_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_certification" ADD CONSTRAINT "provider_certification_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by") REFERENCES "user"("id") ON DELETE SET NULL;