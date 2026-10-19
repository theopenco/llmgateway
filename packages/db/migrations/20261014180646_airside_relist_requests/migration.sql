ALTER TABLE "provider_draft_model" ADD COLUMN "relist_requested_at" timestamp;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "relist_requested_by" text;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "relist_reviewed_at" timestamp;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD COLUMN "relist_review_note" text;--> statement-breakpoint
ALTER TABLE "provider_draft_model" ADD CONSTRAINT "provider_draft_model_relist_requested_by_user_id_fkey" FOREIGN KEY ("relist_requested_by") REFERENCES "user"("id") ON DELETE SET NULL;