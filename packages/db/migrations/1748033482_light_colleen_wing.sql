ALTER TABLE "log" ADD COLUMN "unified_finish_reason" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "used_mode" text DEFAULT 'api-keys' NOT NULL;