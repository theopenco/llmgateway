CREATE TABLE "chat_support_conversation" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" text,
	"email" text,
	"ip_address" text,
	"user_agent" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"escalated_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "chat_support_message" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"conversation_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"sequence" integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_support_conversation_created_at_idx" ON "chat_support_conversation" ("created_at");--> statement-breakpoint
CREATE INDEX "chat_support_message_conversation_id_idx" ON "chat_support_message" ("conversation_id");--> statement-breakpoint
ALTER TABLE "chat_support_message" ADD CONSTRAINT "chat_support_message_Wd0B6G0H0z05_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_support_conversation"("id") ON DELETE CASCADE;