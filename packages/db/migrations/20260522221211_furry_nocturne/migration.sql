CREATE TABLE "playground_image_history" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"prompt" text NOT NULL,
	"input_images" jsonb,
	"models" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "playground_video_history" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"user_id" text NOT NULL,
	"prompt" text NOT NULL,
	"frame_inputs" jsonb,
	"reference_images" jsonb,
	"models" jsonb NOT NULL
);
--> statement-breakpoint
CREATE INDEX "playground_image_history_user_id_idx" ON "playground_image_history" ("user_id");--> statement-breakpoint
CREATE INDEX "playground_video_history_user_id_idx" ON "playground_video_history" ("user_id");--> statement-breakpoint
ALTER TABLE "playground_image_history" ADD CONSTRAINT "playground_image_history_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "playground_video_history" ADD CONSTRAINT "playground_video_history_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;