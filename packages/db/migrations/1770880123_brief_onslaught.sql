ALTER TABLE "log" ADD COLUMN "reasoning_max_tokens" integer;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "reasoning_max_tokens" boolean;