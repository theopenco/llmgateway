ALTER TABLE "model" ADD COLUMN "released_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "aliases" json DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "description" text DEFAULT '(empty)' NOT NULL;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "stability" text DEFAULT 'stable' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "json_output" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "json_output_schema" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "web_search" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "discount" numeric DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "stability" text DEFAULT 'stable' NOT NULL;--> statement-breakpoint
update "model" set "name" = false where "name" is null;--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "name" SET DEFAULT '(empty)';--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "name" SET NOT NULL;--> statement-breakpoint
update "model" set "free" = false where "free" is null;--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "free" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "free" SET NOT NULL;--> statement-breakpoint
update "model" set "output" = '["text"]' where "output" is null;--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "output" SET DEFAULT '["text"]';--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "output" SET NOT NULL;
