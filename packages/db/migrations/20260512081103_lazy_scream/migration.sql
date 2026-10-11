ALTER TABLE "api_key_hourly_model_stats" ADD COLUMN "audio_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats" ADD COLUMN "audio_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_model_stats" ADD COLUMN "audio_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "global_source_stats" ADD COLUMN "audio_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "audio_input_tokens" numeric;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "audio_input_cost" real;--> statement-breakpoint
ALTER TABLE "message" ADD COLUMN "audios" text;--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" ADD COLUMN "audio_input_cost" real DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "project_hourly_stats" ADD COLUMN "audio_input_cost" real DEFAULT 0 NOT NULL;