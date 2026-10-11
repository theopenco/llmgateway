CREATE TABLE "audit_log" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "guardrail_config" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL UNIQUE,
	"enabled" boolean DEFAULT true NOT NULL,
	"system_rules" jsonb DEFAULT '{"prompt_injection":{"enabled":true,"action":"block"},"jailbreak":{"enabled":true,"action":"block"},"pii_detection":{"enabled":true,"action":"redact"},"secrets":{"enabled":true,"action":"block"},"file_types":{"enabled":true,"action":"block"},"document_leakage":{"enabled":false,"action":"warn"}}',
	"max_file_size_mb" integer DEFAULT 10 NOT NULL,
	"allowed_file_types" text[] DEFAULT '{image/jpeg,image/png,image/gif,image/webp}'::text[] NOT NULL,
	"pii_action" text DEFAULT 'redact',
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardrail_rule" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"action" text DEFAULT 'block' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "guardrail_violation" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"log_id" text,
	"rule_id" text NOT NULL,
	"rule_name" text NOT NULL,
	"category" text NOT NULL,
	"action_taken" text NOT NULL,
	"matched_pattern" text,
	"matched_content" text,
	"content_hash" text,
	"api_key_id" text,
	"model" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "audit_log_organization_id_created_at_idx" ON "audit_log" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_user_id_idx" ON "audit_log" ("user_id");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" ("action");--> statement-breakpoint
CREATE INDEX "audit_log_resource_type_idx" ON "audit_log" ("resource_type");--> statement-breakpoint
CREATE INDEX "guardrail_config_organization_id_idx" ON "guardrail_config" ("organization_id");--> statement-breakpoint
CREATE INDEX "guardrail_rule_organization_id_idx" ON "guardrail_rule" ("organization_id");--> statement-breakpoint
CREATE INDEX "guardrail_rule_priority_idx" ON "guardrail_rule" ("priority");--> statement-breakpoint
CREATE INDEX "guardrail_violation_org_created_idx" ON "guardrail_violation" ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "guardrail_violation_rule_created_idx" ON "guardrail_violation" ("rule_id","created_at");--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "guardrail_config" ADD CONSTRAINT "guardrail_config_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "guardrail_rule" ADD CONSTRAINT "guardrail_rule_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "guardrail_violation" ADD CONSTRAINT "guardrail_violation_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;