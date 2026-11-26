CREATE TABLE "airside_payout_statement" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_company_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"request_count" integer DEFAULT 0 NOT NULL,
	"gross_amount" numeric DEFAULT '0' NOT NULL,
	"gateway_fee_amount" numeric DEFAULT '0' NOT NULL,
	"adjustment_amount" numeric DEFAULT '0' NOT NULL,
	"adjustment_note" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"computed_at" timestamp DEFAULT now() NOT NULL,
	"approved_at" timestamp,
	"approved_by" text,
	"paid_at" timestamp,
	"paid_by" text,
	"payment_reference" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "airside_payout_statement_provider_period_uidx" ON "airside_payout_statement" ("provider_id","period_start");--> statement-breakpoint
CREATE INDEX "airside_payout_statement_company_idx" ON "airside_payout_statement" ("provider_company_id");--> statement-breakpoint
CREATE INDEX "airside_payout_statement_status_idx" ON "airside_payout_statement" ("status");--> statement-breakpoint
ALTER TABLE "airside_payout_statement" ADD CONSTRAINT "airside_payout_statement_8fUDM7ImgCEQ_fkey" FOREIGN KEY ("provider_company_id") REFERENCES "provider_company"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "airside_payout_statement" ADD CONSTRAINT "airside_payout_statement_approved_by_user_id_fkey" FOREIGN KEY ("approved_by") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "airside_payout_statement" ADD CONSTRAINT "airside_payout_statement_paid_by_user_id_fkey" FOREIGN KEY ("paid_by") REFERENCES "user"("id") ON DELETE SET NULL;