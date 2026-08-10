ALTER TABLE "organization_invite" ADD COLUMN "lead_project_ids" jsonb;--> statement-breakpoint
ALTER TABLE "user_project" ADD COLUMN "role" text DEFAULT 'member' NOT NULL;