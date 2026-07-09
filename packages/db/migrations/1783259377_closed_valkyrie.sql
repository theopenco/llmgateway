CREATE TABLE "chat_project" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"instructions" text DEFAULT '' NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text
);
--> statement-breakpoint
CREATE TABLE "chat_project_file" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"mime_type" text NOT NULL,
	"size" integer NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"error" text,
	"chunk_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_project_file_chunk" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"file_id" text NOT NULL,
	"project_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"embedding" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "chat" ADD COLUMN "project_id" text;--> statement-breakpoint
CREATE INDEX "chat_project_id_idx" ON "chat" ("project_id");--> statement-breakpoint
CREATE INDEX "chat_project_user_id_idx" ON "chat_project" ("user_id");--> statement-breakpoint
CREATE INDEX "chat_project_file_project_id_idx" ON "chat_project_file" ("project_id");--> statement-breakpoint
CREATE INDEX "chat_project_file_chunk_file_id_idx" ON "chat_project_file_chunk" ("file_id");--> statement-breakpoint
CREATE INDEX "chat_project_file_chunk_project_id_idx" ON "chat_project_file_chunk" ("project_id");--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_project_id_chat_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "chat_project"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "chat_project" ADD CONSTRAINT "chat_project_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_project" ADD CONSTRAINT "chat_project_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "chat_project_file" ADD CONSTRAINT "chat_project_file_project_id_chat_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "chat_project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_project_file_chunk" ADD CONSTRAINT "chat_project_file_chunk_file_id_chat_project_file_id_fkey" FOREIGN KEY ("file_id") REFERENCES "chat_project_file"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "chat_project_file_chunk" ADD CONSTRAINT "chat_project_file_chunk_project_id_chat_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "chat_project"("id") ON DELETE CASCADE;