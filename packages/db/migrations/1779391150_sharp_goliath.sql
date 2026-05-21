ALTER TABLE "chat_support_conversation" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "chat_support_conversation" ADD COLUMN "resolved_at" timestamp;--> statement-breakpoint
ALTER TABLE "chat_support_conversation" ADD COLUMN "rating" integer;--> statement-breakpoint
ALTER TABLE "chat_support_message" ADD COLUMN "reaction" text;--> statement-breakpoint
CREATE INDEX "chat_support_conversation_client_id_idx" ON "chat_support_conversation" ("client_id");