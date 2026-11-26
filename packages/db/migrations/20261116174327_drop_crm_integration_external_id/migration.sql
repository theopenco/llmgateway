CREATE TABLE "newsletter_issue" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"broadcast_id" text
);
--> statement-breakpoint
-- migrate:contract #5075
ALTER TABLE "crm_integration" DROP COLUMN "external_id";