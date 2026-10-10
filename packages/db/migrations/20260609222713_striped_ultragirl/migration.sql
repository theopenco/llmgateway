CREATE TABLE "playground_audio_history" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" text,
	"prompt" text NOT NULL,
	"voice" text,
	"models" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "playground_audio_history_user_id_idx" ON "playground_audio_history" ("user_id");--> statement-breakpoint
ALTER TABLE "playground_audio_history" ADD CONSTRAINT "playground_audio_history_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "playground_audio_history" ADD CONSTRAINT "playground_audio_history_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;