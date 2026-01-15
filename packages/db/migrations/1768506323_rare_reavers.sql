ALTER TABLE "model" ADD COLUMN "released_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "aliases" json DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "description" text DEFAULT '';--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "stability" text DEFAULT 'stable';--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "json_output" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "json_output_schema" boolean;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "web_search" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "discount" numeric DEFAULT '0';--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "stability" text DEFAULT 'stable';--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "name" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "free" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "output" SET DEFAULT '["text"]';