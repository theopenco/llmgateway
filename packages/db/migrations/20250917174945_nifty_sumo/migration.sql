ALTER TABLE "log" ADD COLUMN "time_to_first_token" integer;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "time_to_first_reasoning_token" integer;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "avg_time_to_first_token" real;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "avg_time_to_first_reasoning_token" real;--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "total_time_to_first_token" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "total_time_to_first_reasoning_token" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "avg_time_to_first_token" real;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "avg_time_to_first_reasoning_token" real;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "total_time_to_first_token" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "total_time_to_first_reasoning_token" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "avg_time_to_first_token" real;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "avg_time_to_first_reasoning_token" real;