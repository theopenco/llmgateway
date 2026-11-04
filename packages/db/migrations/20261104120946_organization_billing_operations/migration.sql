-- migrate:reviewed New empty per-organization operation table; FK validation scans no existing rows.
CREATE TABLE "organization_billing_operation" (
	"organization_id" text PRIMARY KEY,
	"checkout_session_id" text,
	"checkout_configuration" text
);
--> statement-breakpoint
ALTER TABLE "organization_billing_operation" ADD CONSTRAINT "organization_billing_operation_On4mS2o8scuz_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;