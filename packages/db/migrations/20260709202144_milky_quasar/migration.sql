CREATE TABLE "provider_listing_request" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_name" text NOT NULL,
	"email" text NOT NULL,
	"url" text NOT NULL,
	"country" text NOT NULL,
	"compliance_soc2_type2" boolean DEFAULT false NOT NULL,
	"compliance_iso27001" boolean DEFAULT false NOT NULL,
	"compliance_gdpr" boolean DEFAULT false NOT NULL,
	"data_retention_days" integer,
	"trains_on_data" boolean,
	"payment_status" text DEFAULT 'unpaid' NOT NULL,
	"stripe_checkout_session_id" text,
	"paid_at" timestamp,
	"honeypot" text,
	"client_timestamp_ms" text,
	"ip_address" text,
	"user_agent" text,
	"spam_filter_status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"archived_at" timestamp,
	CONSTRAINT "provider_listing_request_payment_status_check" CHECK ("payment_status" IN ('unpaid', 'paid', 'refunded'))
);
--> statement-breakpoint
CREATE INDEX "provider_listing_request_created_at_idx" ON "provider_listing_request" ("created_at");--> statement-breakpoint
CREATE INDEX "provider_listing_request_email_idx" ON "provider_listing_request" ("email");--> statement-breakpoint
CREATE INDEX "provider_listing_request_status_idx" ON "provider_listing_request" ("spam_filter_status");