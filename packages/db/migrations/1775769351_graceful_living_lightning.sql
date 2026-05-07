CREATE TABLE "chat_support_read_status" (
	"id" text PRIMARY KEY,
	"conversation_id" text NOT NULL,
	"admin_user_id" text NOT NULL,
	"last_read_message_count" integer DEFAULT 0 NOT NULL,
	"read_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_support_read_status_conv_admin_idx" ON "chat_support_read_status" ("conversation_id","admin_user_id");--> statement-breakpoint
ALTER TABLE "chat_support_read_status" ADD CONSTRAINT "chat_support_read_status_oDVimXRR0BL9_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_support_conversation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_support_read_status" ADD CONSTRAINT "chat_support_read_status_admin_user_id_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "user"("id") ON DELETE CASCADE;