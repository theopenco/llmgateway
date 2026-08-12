ALTER TABLE "organization" ADD COLUMN "sso_default_projects_configured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ALTER COLUMN "sso_default_projects_configured" SET DEFAULT true;
