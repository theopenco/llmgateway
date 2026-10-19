ALTER TABLE "content_filter_hourly_model_stats" ADD COLUMN "internal_scope" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_filter_hourly_stats" ADD COLUMN "internal_scope" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_filter_hourly_model_stats" DROP CONSTRAINT "content_filter_hourly_model_stats_bucket_unique";--> statement-breakpoint
ALTER TABLE "content_filter_hourly_model_stats" ADD CONSTRAINT "content_filter_hourly_model_stats_bucket_unique" UNIQUE("hour_timestamp","organization_id","project_id","used_model","used_provider","category","classifier","role","internal_scope");--> statement-breakpoint
ALTER TABLE "content_filter_hourly_stats" DROP CONSTRAINT "content_filter_hourly_stats_bucket_unique";--> statement-breakpoint
ALTER TABLE "content_filter_hourly_stats" ADD CONSTRAINT "content_filter_hourly_stats_bucket_unique" UNIQUE("hour_timestamp","organization_id","project_id","category","classifier","role","internal_scope");