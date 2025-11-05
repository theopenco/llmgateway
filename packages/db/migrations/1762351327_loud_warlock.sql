ALTER TABLE "organization" ADD COLUMN "billing_company" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "billing_address" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "billing_tax_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "billing_notes" text;--> statement-breakpoint
ALTER TABLE "transaction" ADD CONSTRAINT "transaction_stripe_invoice_id_unique" UNIQUE("stripe_invoice_id");