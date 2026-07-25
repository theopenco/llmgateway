ALTER TABLE "api_key_hourly_model_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_model_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_source_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_source_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_stats" ADD COLUMN "audio_output_cost" real DEFAULT 0 NOT NULL;