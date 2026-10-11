ALTER TABLE "log" ADD COLUMN "image_input_tokens" numeric;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "image_output_tokens" numeric;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "image_input_cost" real;--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "image_output_cost" real;