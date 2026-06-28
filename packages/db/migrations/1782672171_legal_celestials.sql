ALTER TABLE "video_job" ADD COLUMN "log_id" text;--> statement-breakpoint
UPDATE "video_job" SET "log_id" = "log"."id" FROM "log" WHERE "log"."raw_response"->>'id' = "video_job"."id";--> statement-breakpoint
CREATE INDEX "video_job_log_id_idx" ON "video_job" ("log_id");--> statement-breakpoint
ALTER TABLE "video_job" ADD CONSTRAINT "video_job_log_id_log_id_fkey" FOREIGN KEY ("log_id") REFERENCES "log"("id") ON DELETE SET NULL;