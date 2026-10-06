CREATE TABLE "chat_project_memory" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"project_id" text NOT NULL,
	"content" text NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "chat_project_memory_project_id_idx" ON "chat_project_memory" ("project_id");--> statement-breakpoint
ALTER TABLE "chat_project_memory" ADD CONSTRAINT "chat_project_memory_project_id_chat_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "chat_project"("id") ON DELETE CASCADE;