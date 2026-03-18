CREATE TABLE "enterprise_contact_submission" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"country" text NOT NULL,
	"size" text NOT NULL,
	"message" text NOT NULL,
	"honeypot" text,
	"client_timestamp_ms" text,
	"ip_address" text,
	"user_agent" text,
	"spam_filter_status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text
);
--> statement-breakpoint
CREATE INDEX "enterprise_contact_submission_created_at_idx" ON "enterprise_contact_submission" ("created_at");--> statement-breakpoint
CREATE INDEX "enterprise_contact_submission_email_idx" ON "enterprise_contact_submission" ("email");--> statement-breakpoint
CREATE INDEX "enterprise_contact_submission_status_idx" ON "enterprise_contact_submission" ("spam_filter_status");