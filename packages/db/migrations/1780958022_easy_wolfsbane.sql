ALTER TABLE "chat" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "playground_image_history" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "playground_video_history" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "chat" ADD CONSTRAINT "chat_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "playground_image_history" ADD CONSTRAINT "playground_image_history_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "playground_video_history" ADD CONSTRAINT "playground_video_history_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE SET NULL;