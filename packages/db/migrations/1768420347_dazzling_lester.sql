ALTER TABLE "model" ADD COLUMN "released_at" timestamp;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "aliases" json;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "stability" text;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "json_output" boolean;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "json_output_schema" boolean;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "web_search" boolean;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "discount" numeric;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "stability" text;