ALTER TABLE "end_user_session" ADD COLUMN "token_hash" text;--> statement-breakpoint
ALTER TABLE "end_user_session" ALTER COLUMN "token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_token_hash_key" UNIQUE("token_hash");--> statement-breakpoint
ALTER TABLE "end_user_session" ADD CONSTRAINT "end_user_session_token_xor" CHECK (("token" IS NULL) <> ("token_hash" IS NULL));