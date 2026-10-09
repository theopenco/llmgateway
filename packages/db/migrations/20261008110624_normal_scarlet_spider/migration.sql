CREATE TABLE "aggregation_progress" (
	"job" text NOT NULL,
	"bucket_timestamp" timestamp NOT NULL,
	"refreshed_at" timestamp,
	"finalized_at" timestamp
);
--> statement-breakpoint
CREATE UNIQUE INDEX "aggregation_progress_job_bucket_timestamp_index" ON "aggregation_progress" ("job","bucket_timestamp");--> statement-breakpoint
CREATE INDEX "aggregation_progress_bucket_timestamp_index" ON "aggregation_progress" ("bucket_timestamp");