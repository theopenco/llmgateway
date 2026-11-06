-- migrate:reviewed Additive nullable/constant-default columns preserve previous-release writes; the new table is empty when its FK is validated.
CREATE TABLE "organization_billing_operation" (
	"organization_id" text PRIMARY KEY,
	"checkout_session_id" text,
	"checkout_configuration" text
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "pro_seats" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "pro_extra_api_keys" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "pro_extra_projects" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "pro_sso_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "pro_scim_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "amount_breakdown" json;--> statement-breakpoint
ALTER TABLE "organization_billing_operation" ADD CONSTRAINT "organization_billing_operation_On4mS2o8scuz_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;