-- migrate:reviewed constant-default ADD COLUMNs on three small Airside tables; each is a brief metadata-only lock
ALTER TABLE "provider_claim" ADD COLUMN "auto_approve_fares" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_price_filing" ADD COLUMN "auto_approved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_routing_filing" ADD COLUMN "auto_approved" boolean DEFAULT false NOT NULL;