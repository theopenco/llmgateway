CREATE TABLE "payment_failure" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"user_email" text,
	"amount" numeric,
	"currency" text DEFAULT 'USD' NOT NULL,
	"decline_code" text,
	"error_code" text,
	"failure_message" text,
	"stripe_payment_intent_id" text CONSTRAINT "payment_failure_stripe_pi_idx" UNIQUE,
	"source" text
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "last_top_up_amount" numeric;--> statement-breakpoint
CREATE INDEX "payment_failure_organization_id_idx" ON "payment_failure" ("organization_id");--> statement-breakpoint
CREATE INDEX "payment_failure_created_at_idx" ON "payment_failure" ("created_at");--> statement-breakpoint
CREATE INDEX "payment_failure_decline_code_idx" ON "payment_failure" ("decline_code");--> statement-breakpoint
ALTER TABLE "payment_failure" ADD CONSTRAINT "payment_failure_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;