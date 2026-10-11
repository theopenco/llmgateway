ALTER TABLE "api_key" ADD COLUMN "usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "usage" numeric DEFAULT '0' NOT NULL;