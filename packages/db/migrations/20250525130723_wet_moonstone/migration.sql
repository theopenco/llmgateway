ALTER TABLE "log" ALTER COLUMN "prompt_tokens" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "log" ALTER COLUMN "completion_tokens" SET DATA TYPE numeric;--> statement-breakpoint
ALTER TABLE "log" ALTER COLUMN "total_tokens" SET DATA TYPE numeric;