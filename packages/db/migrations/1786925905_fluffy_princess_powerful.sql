CREATE TABLE "sso_project_mapping" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"group_name" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "sso_default_projects_configured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "sso_default_projects_configured" SET DEFAULT true;--> statement-breakpoint
ALTER TABLE "user_project" ADD COLUMN "source" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sso_project_mapping_org_group_project_unique" ON "sso_project_mapping" ("organization_id","group_name","project_id");--> statement-breakpoint
CREATE INDEX "sso_project_mapping_organization_id_idx" ON "sso_project_mapping" ("organization_id");--> statement-breakpoint
ALTER TABLE "sso_project_mapping" ADD CONSTRAINT "sso_project_mapping_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sso_project_mapping" ADD CONSTRAINT "sso_project_mapping_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;