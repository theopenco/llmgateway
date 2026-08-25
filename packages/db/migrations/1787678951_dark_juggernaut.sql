DROP INDEX "provider_claim_active_provider_uidx";--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "reviewed_by" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "review_note" text;--> statement-breakpoint
ALTER TABLE "provider_claim" ADD COLUMN "reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "provider_claim" ALTER COLUMN "status" SET DEFAULT 'pending';--> statement-breakpoint
CREATE INDEX "provider_claim_status_idx" ON "provider_claim" ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_claim_active_provider_uidx" ON "provider_claim" ("provider_id") WHERE status IN ('pending', 'active');