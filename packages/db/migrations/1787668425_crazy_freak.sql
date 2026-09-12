ALTER TABLE "api_key" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "token_masked" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "kind" text DEFAULT 'regular' NOT NULL;--> statement-breakpoint
ALTER TABLE "end_user_session" ADD COLUMN "token_hash" text;--> statement-breakpoint
UPDATE "api_key" SET "kind" = 'playground', "description" = 'Playground' WHERE "description" = 'Auto-generated playground key';--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "end_user_session" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_token_hash_key" UNIQUE("token_hash");--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_token_hash_key" UNIQUE("token_hash");
