CREATE TABLE "user_project" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_organization_id" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_developer_max_api_keys" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_developer_usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_developer_period_usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_developer_period_usage_duration_value" integer;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "default_developer_period_usage_duration_unit" text;--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "max_api_keys" integer;--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "period_usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "period_usage_duration_value" integer;--> statement-breakpoint
ALTER TABLE "user_organization" ADD COLUMN "period_usage_duration_unit" text;--> statement-breakpoint
CREATE UNIQUE INDEX "user_project_membership_project_unique" ON "user_project" ("user_organization_id","project_id");--> statement-breakpoint
CREATE INDEX "user_project_user_organization_id_idx" ON "user_project" ("user_organization_id");--> statement-breakpoint
CREATE INDEX "user_project_project_id_idx" ON "user_project" ("project_id");--> statement-breakpoint
ALTER TABLE "user_project" ADD CONSTRAINT "user_project_user_organization_id_user_organization_id_fkey" FOREIGN KEY ("user_organization_id") REFERENCES "user_organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_project" ADD CONSTRAINT "user_project_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;