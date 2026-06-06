CREATE TABLE "end_customer" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"external_id" text NOT NULL,
	"email" text,
	"name" text,
	"stripe_customer_id" text UNIQUE,
	"metadata" json,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"end_customer_id" text NOT NULL UNIQUE,
	"project_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"balance" numeric DEFAULT '0' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"markup_percent_override" numeric,
	"spend_cap_per_session" numeric,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallet_ledger" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"wallet_id" text NOT NULL,
	"end_customer_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"amount" numeric NOT NULL,
	"balance_after" numeric NOT NULL,
	"gross_paid" numeric,
	"platform_fee" numeric,
	"developer_margin" numeric,
	"net_credited" numeric,
	"stripe_payment_intent_id" text,
	"gateway_log_id" text,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "key_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "end_customer_wallet_id" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "end_customer_wallet_id" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "end_customer_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "end_user_margin_balance" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "end_user_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "end_user_markup_percent" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "allowed_origins" json;--> statement-breakpoint
CREATE INDEX "api_key_key_type_expires_at_idx" ON "api_key" ("key_type","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "end_customer_project_id_external_id_unique" ON "end_customer" ("project_id","external_id");--> statement-breakpoint
CREATE INDEX "end_customer_organization_id_idx" ON "end_customer" ("organization_id");--> statement-breakpoint
CREATE INDEX "end_customer_project_id_idx" ON "end_customer" ("project_id");--> statement-breakpoint
CREATE INDEX "log_end_customer_wallet_id_idx" ON "log" ("end_customer_wallet_id","created_at") WHERE end_customer_wallet_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX "wallet_organization_id_idx" ON "wallet" ("organization_id");--> statement-breakpoint
CREATE INDEX "wallet_project_id_idx" ON "wallet" ("project_id");--> statement-breakpoint
CREATE INDEX "wallet_ledger_wallet_id_idx" ON "wallet_ledger" ("wallet_id");--> statement-breakpoint
CREATE INDEX "wallet_ledger_organization_id_idx" ON "wallet_ledger" ("organization_id");--> statement-breakpoint
CREATE INDEX "wallet_ledger_stripe_payment_intent_id_idx" ON "wallet_ledger" ("stripe_payment_intent_id");--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_end_customer_wallet_id_wallet_id_fkey" FOREIGN KEY ("end_customer_wallet_id") REFERENCES "wallet"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_customer" ADD CONSTRAINT "end_customer_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_customer" ADD CONSTRAINT "end_customer_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_end_customer_id_end_customer_id_fkey" FOREIGN KEY ("end_customer_id") REFERENCES "end_customer"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_wallet_id_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_end_customer_id_end_customer_id_fkey" FOREIGN KEY ("end_customer_id") REFERENCES "end_customer"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;