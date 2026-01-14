ALTER TABLE "model" ALTER COLUMN "released_at" SET DEFAULT now();--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "name" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "aliases" SET DEFAULT '[]';--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "description" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "free" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "output" SET DEFAULT '["text"]';--> statement-breakpoint
ALTER TABLE "model" ALTER COLUMN "stability" SET DEFAULT 'stable';--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ALTER COLUMN "json_output" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ALTER COLUMN "web_search" SET DEFAULT false;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ALTER COLUMN "discount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ALTER COLUMN "stability" SET DEFAULT 'stable';