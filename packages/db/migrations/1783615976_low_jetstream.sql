ALTER TABLE "enterprise_contact_submission" ADD COLUMN "kind" text DEFAULT 'enterprise' NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ADD COLUMN "provider_url" text;--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ADD COLUMN "compliance_soc2_type2" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ADD COLUMN "compliance_iso27001" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ADD COLUMN "compliance_gdpr" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ADD COLUMN "data_retention_days" integer;--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ADD COLUMN "trains_on_data" boolean;--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ADD COLUMN "payment_status" text DEFAULT 'unpaid' NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ADD COLUMN "stripe_checkout_session_id" text;--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ADD COLUMN "paid_at" timestamp;--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ALTER COLUMN "size" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ALTER COLUMN "message" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ADD CONSTRAINT "enterprise_contact_submission_kind_check" CHECK ("kind" IN ('enterprise', 'provider'));--> statement-breakpoint
ALTER TABLE "enterprise_contact_submission" ADD CONSTRAINT "enterprise_contact_submission_payment_status_check" CHECK ("payment_status" IN ('unpaid', 'paid', 'refunded'));