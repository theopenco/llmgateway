ALTER TABLE "log" RENAME COLUMN "service_tier" TO "requested_service_tier";--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "used_service_tier" text;