ALTER TABLE "log" ADD COLUMN "provider_key_id" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "usage_limit" numeric;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "usage" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "video_job" ADD COLUMN "provider_key_id" text;--> statement-breakpoint
CREATE INDEX "log_provider_key_id_created_at_idx" ON "log" ("provider_key_id","created_at") WHERE provider_key_id IS NOT NULL;--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("provider_key_id") REFERENCES "provider_key"("id") ON DELETE SET NULL;