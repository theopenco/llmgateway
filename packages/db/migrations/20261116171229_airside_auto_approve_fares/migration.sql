-- migrate:reviewed constant-default ADD COLUMNs on three small Airside tables and one DROP on the small crm_integration table; each is a brief metadata-only lock
ALTER TABLE "provider_claim" ADD COLUMN "auto_approve_fares" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_price_filing" ADD COLUMN "auto_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_routing_filing" ADD COLUMN "auto_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- migrate:contract #5075
ALTER TABLE "crm_integration" DROP COLUMN "external_id";