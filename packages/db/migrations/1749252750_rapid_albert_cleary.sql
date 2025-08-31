ALTER TABLE "log" ALTER COLUMN "messages" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "retention_level" text DEFAULT 'retain' NOT NULL;