CREATE TABLE "referral" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"referrer_organization_id" text NOT NULL,
	"referred_organization_id" text NOT NULL UNIQUE
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "referral_earnings" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
CREATE INDEX "referral_referrer_organization_id_idx" ON "referral" ("referrer_organization_id");--> statement-breakpoint
CREATE INDEX "referral_referred_organization_id_idx" ON "referral" ("referred_organization_id");--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_referrer_organization_id_organization_id_fkey" FOREIGN KEY ("referrer_organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "referral" ADD CONSTRAINT "referral_referred_organization_id_organization_id_fkey" FOREIGN KEY ("referred_organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;