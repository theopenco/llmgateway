ALTER TABLE "api_key" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "api_key" ADD COLUMN "token_masked" text;--> statement-breakpoint
ALTER TABLE "api_key" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_token_hash_key" UNIQUE("token_hash");--> statement-breakpoint
ALTER TABLE "api_key" ADD CONSTRAINT "api_key_token_xor" CHECK (("token" IS NULL) <> ("token_hash" IS NULL));