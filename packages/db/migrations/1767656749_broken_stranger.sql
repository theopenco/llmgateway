ALTER TABLE "organization" ADD COLUMN "payment_failure_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "last_payment_failure_at" timestamp;