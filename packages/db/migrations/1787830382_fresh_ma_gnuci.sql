ALTER TABLE "api_key" DROP CONSTRAINT "api_key_token_unique";--> statement-breakpoint
ALTER TABLE "end_user_session" DROP CONSTRAINT "end_user_session_token_key";--> statement-breakpoint
ALTER TABLE "provider_key" DROP CONSTRAINT "provider_key_token_xor";--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "token_masked" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "end_user_session" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ALTER COLUMN "token_ciphertext" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ALTER COLUMN "token_masked" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ALTER COLUMN "token_hash" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "end_user_session" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "provider_key" DROP COLUMN "token";--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_token_hash_required" CHECK ("key_type" = 'platform_publishable' OR "token_hash" IS NOT NULL);