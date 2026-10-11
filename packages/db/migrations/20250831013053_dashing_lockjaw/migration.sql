ALTER TABLE "log" ADD COLUMN "raw_request" jsonb;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "raw_response" jsonb;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "upstream_request" jsonb;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "upstream_response" jsonb;