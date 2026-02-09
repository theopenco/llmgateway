DROP TABLE "discount";--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "reasoning_max_tokens" integer;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "supports_reasoning_max_tokens" boolean;--> statement-breakpoint
ALTER TABLE "log" DROP COLUMN "image_input_tokens";--> statement-breakpoint
ALTER TABLE "log" DROP COLUMN "image_output_tokens";--> statement-breakpoint
ALTER TABLE "log" DROP COLUMN "image_input_cost";--> statement-breakpoint
ALTER TABLE "log" DROP COLUMN "image_output_cost";