ALTER TABLE "chat" ADD COLUMN "comparison_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "parent_chat_id" text;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_parent_chat_id_chat_id_fkey" FOREIGN KEY ("parent_chat_id") REFERENCES "chat"("id") ON DELETE CASCADE;