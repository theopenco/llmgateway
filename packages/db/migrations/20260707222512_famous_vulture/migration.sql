CREATE TABLE "sso_default_project" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "sso_default_project_org_project_unique" ON "sso_default_project" ("organization_id","project_id");--> statement-breakpoint
CREATE INDEX "sso_default_project_organization_id_idx" ON "sso_default_project" ("organization_id");--> statement-breakpoint
ALTER TABLE "sso_default_project" ADD CONSTRAINT "sso_default_project_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "sso_default_project" ADD CONSTRAINT "sso_default_project_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;