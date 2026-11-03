CREATE TABLE "crm_integration" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider" text NOT NULL,
	"user_id" text NOT NULL,
	"account_email" text NOT NULL,
	"display_name" text,
	"external_id" text,
	"credentials" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
ALTER TABLE "crm_activity" ADD COLUMN "external_ref" text;--> statement-breakpoint
-- migrate:allow-blocking-index crm_activity holds a few hundred internal CRM rows
CREATE UNIQUE INDEX IF NOT EXISTS "crm_activity_external_ref_idx" ON "crm_activity" ("external_ref") WHERE external_ref IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "crm_integration_provider_email_idx" ON "crm_integration" ("provider","account_email");--> statement-breakpoint
ALTER TABLE "crm_integration" ADD CONSTRAINT "crm_integration_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;