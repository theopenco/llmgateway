ALTER TABLE "log" ADD COLUMN "responses_api_id" text;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "responses_api_data" jsonb;