ALTER TABLE "api_key" ADD COLUMN "kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
UPDATE "api_key" SET "kind" = 'playground' WHERE "description" = 'Auto-generated playground key';
