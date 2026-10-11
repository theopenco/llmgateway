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
CREATE TABLE "end_user_session" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"token" text NOT NULL UNIQUE,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"end_customer_id" text NOT NULL,
	"wallet_id" text NOT NULL,
	"created_by" text NOT NULL,
	"scope" json,
	"usage_limit" numeric,
	"usage" numeric DEFAULT '0' NOT NULL,
	"period_usage_limit" numeric,
	"period_usage_duration_value" integer,
	"period_usage_duration_unit" text,
	"current_period_usage" numeric DEFAULT '0' NOT NULL,
	"current_period_started_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "platform_webhook_delivery" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"webhook_endpoint_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp,
	"response_status" integer,
	"last_error" text
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
CREATE TABLE "webhook_endpoint" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"enabled_events" json,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "key_type" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "end_customer_wallet_id" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "end_user_session_id" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "end_customer_wallet_id" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "end_customer_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "end_user_margin_balance" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "stripe_connect_account_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "stripe_connect_onboarded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "end_user_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "end_user_markup_percent" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "allowed_origins" json;--> statement-breakpoint
ALTER TABLE "video_job" ADD COLUMN "end_user_session_id" text;--> statement-breakpoint
ALTER TABLE "video_job" ADD COLUMN "end_customer_wallet_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD CONSTRAINT "organization_stripe_connect_account_id_key" UNIQUE("stripe_connect_account_id");--> statement-breakpoint
CREATE INDEX "api_key_key_type_expires_at_idx" ON "api_key" ("key_type","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "api_key_end_user_customer_wallet_unique" ON "api_key" ("end_customer_wallet_id") WHERE "key_type" = 'end_user_customer' AND "status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "end_customer_project_id_external_id_unique" ON "end_customer" ("project_id","external_id");--> statement-breakpoint
CREATE INDEX "end_customer_organization_id_idx" ON "end_customer" ("organization_id");--> statement-breakpoint
CREATE INDEX "end_customer_project_id_idx" ON "end_customer" ("project_id");--> statement-breakpoint
CREATE INDEX "end_user_session_project_id_idx" ON "end_user_session" ("project_id");--> statement-breakpoint
CREATE INDEX "end_user_session_wallet_id_idx" ON "end_user_session" ("wallet_id");--> statement-breakpoint
CREATE INDEX "end_user_session_status_expires_at_idx" ON "end_user_session" ("status","expires_at");--> statement-breakpoint
CREATE INDEX "platform_webhook_delivery_status_next_attempt_idx" ON "platform_webhook_delivery" ("status","next_attempt_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "platform_webhook_delivery_endpoint_id_idx" ON "platform_webhook_delivery" ("webhook_endpoint_id");--> statement-breakpoint
CREATE INDEX "video_job_end_user_session_id_idx" ON "video_job" ("end_user_session_id");--> statement-breakpoint
CREATE INDEX "wallet_organization_id_idx" ON "wallet" ("organization_id");--> statement-breakpoint
CREATE INDEX "wallet_project_id_idx" ON "wallet" ("project_id");--> statement-breakpoint
CREATE INDEX "wallet_ledger_wallet_id_idx" ON "wallet_ledger" ("wallet_id");--> statement-breakpoint
CREATE INDEX "wallet_ledger_organization_id_idx" ON "wallet_ledger" ("organization_id");--> statement-breakpoint
CREATE INDEX "wallet_ledger_stripe_payment_intent_id_idx" ON "wallet_ledger" ("stripe_payment_intent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_ledger_topup_payment_intent_unique" ON "wallet_ledger" ("stripe_payment_intent_id") WHERE "type" = 'topup';--> statement-breakpoint
CREATE UNIQUE INDEX "wallet_ledger_reversal_payment_intent_unique" ON "wallet_ledger" ("stripe_payment_intent_id") WHERE "type" = 'reversal';--> statement-breakpoint
CREATE INDEX "webhook_endpoint_project_id_idx" ON "webhook_endpoint" ("project_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_organization_id_idx" ON "webhook_endpoint" ("organization_id");--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_end_customer_wallet_id_wallet_id_fkey" FOREIGN KEY ("end_customer_wallet_id") REFERENCES "wallet"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_customer" ADD CONSTRAINT "end_customer_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_customer" ADD CONSTRAINT "end_customer_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_end_customer_id_end_customer_id_fkey" FOREIGN KEY ("end_customer_id") REFERENCES "end_customer"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_wallet_id_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_created_by_user_id_fkey" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "platform_webhook_delivery" ADD CONSTRAINT "platform_webhook_delivery_6o69dFuU5JAY_fkey" FOREIGN KEY ("webhook_endpoint_id") REFERENCES "webhook_endpoint"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_end_user_session_id_end_user_session_id_fkey" FOREIGN KEY ("end_user_session_id") REFERENCES "end_user_session"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_end_customer_wallet_id_wallet_id_fkey" FOREIGN KEY ("end_customer_wallet_id") REFERENCES "wallet"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_end_customer_id_end_customer_id_fkey" FOREIGN KEY ("end_customer_id") REFERENCES "end_customer"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wallet" ADD CONSTRAINT "wallet_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_wallet_id_wallet_id_fkey" FOREIGN KEY ("wallet_id") REFERENCES "wallet"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_end_customer_id_end_customer_id_fkey" FOREIGN KEY ("end_customer_id") REFERENCES "end_customer"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wallet_ledger" ADD CONSTRAINT "wallet_ledger_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;