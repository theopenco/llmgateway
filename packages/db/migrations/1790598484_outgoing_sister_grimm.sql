ALTER TABLE "content_filter_hourly_model_stats" DROP CONSTRAINT "content_filter_hourly_model_stats_hour_timestamp_organization_id_project_id_used_model_used_provider_category_unique";--> statement-breakpoint
ALTER TABLE "content_filter_hourly_stats" DROP CONSTRAINT "content_filter_hourly_stats_hour_timestamp_organization_id_project_id_category_unique";--> statement-breakpoint
ALTER TABLE "content_filter_hourly_model_stats" ADD COLUMN "classifier" text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_filter_hourly_model_stats" ADD COLUMN "role" text DEFAULT 'deciding' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_filter_hourly_model_stats" ADD COLUMN "duration_sum_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_filter_hourly_model_stats" ADD COLUMN "duration_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_filter_hourly_model_stats" ADD COLUMN "duration_max_ms" integer;--> statement-breakpoint
ALTER TABLE "content_filter_hourly_stats" ADD COLUMN "classifier" text DEFAULT 'openai' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_filter_hourly_stats" ADD COLUMN "role" text DEFAULT 'deciding' NOT NULL;--> statement-breakpoint
ALTER TABLE "content_filter_hourly_stats" ADD COLUMN "duration_sum_ms" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_filter_hourly_stats" ADD COLUMN "duration_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "content_filter_hourly_stats" ADD COLUMN "duration_max_ms" integer;--> statement-breakpoint
ALTER TABLE "content_filter_hourly_model_stats" ADD CONSTRAINT "content_filter_hourly_model_stats_bucket_unique" UNIQUE("hour_timestamp","organization_id","project_id","used_model","used_provider","category","classifier","role");--> statement-breakpoint
ALTER TABLE "content_filter_hourly_stats" ADD CONSTRAINT "content_filter_hourly_stats_bucket_unique" UNIQUE("hour_timestamp","organization_id","project_id","category","classifier","role");