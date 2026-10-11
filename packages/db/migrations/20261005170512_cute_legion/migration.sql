CREATE TABLE "provider_listing_payment" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"source" text NOT NULL,
	"provider_company_id" text,
	"provider_listing_request_id" text,
	"amount" numeric NOT NULL,
	"refunded_amount" numeric DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"stripe_checkout_session_id" text NOT NULL,
	"stripe_payment_intent_id" text,
	"paid_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "provider_listing_payment_checkout_session_unique" ON "provider_listing_payment" ("stripe_checkout_session_id");--> statement-breakpoint
CREATE INDEX "provider_listing_payment_payment_intent_idx" ON "provider_listing_payment" ("stripe_payment_intent_id");--> statement-breakpoint
CREATE INDEX "provider_listing_payment_paid_at_idx" ON "provider_listing_payment" ("paid_at");--> statement-breakpoint
ALTER TABLE "provider_listing_payment" ADD CONSTRAINT "provider_listing_payment_8dHnKwh19J1Z_fkey" FOREIGN KEY ("provider_company_id") REFERENCES "provider_company"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "provider_listing_payment" ADD CONSTRAINT "provider_listing_payment_hCaNnJnGq0GN_fkey" FOREIGN KEY ("provider_listing_request_id") REFERENCES "provider_listing_request"("id") ON DELETE SET NULL;