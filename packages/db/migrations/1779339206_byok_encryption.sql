ALTER TABLE "provider_key" ADD COLUMN "token_ciphertext" text;--> statement-breakpoint
ALTER TABLE "provider_key" ADD COLUMN "token_masked" text;--> statement-breakpoint
ALTER TABLE "provider_key" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key" ADD CONSTRAINT "provider_key_token_xor" CHECK ("token" IS NULL OR "token_ciphertext" IS NULL);