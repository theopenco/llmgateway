CREATE TABLE "custom_model" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"provider_key_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"model_name" text NOT NULL,
	"display_name" text,
	"context_size" integer,
	"max_output" integer,
	"input_price" text,
	"output_price" text,
	"cached_input_price" text,
	"cache_read_input_price" text,
	"cache_write_input_price" text,
	"cache_write_input_price1h" text,
	"request_price" text,
	"web_search_price" text,
	"image_input_price" text,
	"audio_input_price" text,
	"streaming" text,
	"vision" boolean,
	"tools" boolean,
	"reasoning" boolean,
	"json_output" boolean,
	"audio" boolean,
	"supported_parameters" jsonb,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "custom_models_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "custom_model_provider_key_id_model_name_unique" ON "custom_model" ("provider_key_id","model_name") WHERE status <> 'deleted';--> statement-breakpoint
CREATE INDEX "custom_model_provider_key_id_idx" ON "custom_model" ("provider_key_id");--> statement-breakpoint
CREATE INDEX "custom_model_organization_id_idx" ON "custom_model" ("organization_id");--> statement-breakpoint
ALTER TABLE "custom_model" ADD CONSTRAINT "custom_model_provider_key_id_provider_key_id_fkey" FOREIGN KEY ("provider_key_id") REFERENCES "provider_key"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "custom_model" ADD CONSTRAINT "custom_model_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;