ALTER TABLE "chat_support_conversation" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "chat_support_conversation" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat_support_conversation" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "chat_support_message" ADD COLUMN "reaction" text;--> statement-breakpoint
CREATE INDEX "chat_support_conversation_client_id_idx" ON "chat_support_conversation" ("client_id");--> statement-breakpoint
ALTER TABLE "chat_support_conversation" ADD CONSTRAINT "chat_support_conversation_rating_check" CHECK ("rating" IS NULL OR ("rating" >= 0 AND "rating" <= 5));--> statement-breakpoint
ALTER TABLE "chat_support_message" ADD CONSTRAINT "chat_support_message_reaction_check" CHECK ("reaction" IS NULL OR "reaction" IN ('like', 'dislike'));