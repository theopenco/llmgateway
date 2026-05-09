CREATE TABLE "chat_share" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"deleted_at" timestamp,
	"chat_id" text NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"model" text NOT NULL,
	"messages" jsonb NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "chat_share_active_chat_id_unique" ON "chat_share" ("chat_id") WHERE "deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "chat_share_chat_id_idx" ON "chat_share" ("chat_id");--> statement-breakpoint
CREATE INDEX "chat_share_deleted_at_idx" ON "chat_share" ("deleted_at");--> statement-breakpoint
ALTER TABLE "chat_share" ADD CONSTRAINT "chat_share_chat_id_chat_id_fkey" FOREIGN KEY ("chat_id") REFERENCES "chat"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_share" ADD CONSTRAINT "chat_share_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;
