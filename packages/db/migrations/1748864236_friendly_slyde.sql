ALTER TABLE "organization" ADD COLUMN "status" text DEFAULT 'active';--> statement-breakpoint
ALTER TABLE "project" ADD COLUMN "status" text DEFAULT 'active';