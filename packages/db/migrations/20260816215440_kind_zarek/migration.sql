ALTER TABLE "guardrail_config" DROP CONSTRAINT "guardrail_config_organization_id_key";--> statement-breakpoint
ALTER TABLE "guardrail_config" ADD COLUMN "project_id" text;--> statement-breakpoint
ALTER TABLE "guardrail_config" ADD COLUMN "inherit_organization" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "guardrail_rule" ADD COLUMN "project_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "guardrail_config_organization_id_unique" ON "guardrail_config" ("organization_id") WHERE "project_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "guardrail_config_project_id_unique" ON "guardrail_config" ("project_id") WHERE "project_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "guardrail_rule_project_id_idx" ON "guardrail_rule" ("project_id");--> statement-breakpoint
ALTER TABLE "guardrail_config" ADD CONSTRAINT "guardrail_config_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "guardrail_rule" ADD CONSTRAINT "guardrail_rule_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;