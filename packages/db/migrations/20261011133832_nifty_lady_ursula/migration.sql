CREATE TABLE "organization_provider_margin_share" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL UNIQUE,
	"share_percent" numeric DEFAULT '0' NOT NULL,
	"total_accrued" numeric DEFAULT '0' NOT NULL,
	"pending_transaction_amount" numeric DEFAULT '0' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization_provider_margin_share" ADD CONSTRAINT "organization_provider_margin_share_EkeweMXjRfkU_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;