DROP INDEX "chat_share_active_chat_id_unique";--> statement-breakpoint
ALTER TABLE "chat_share" ADD COLUMN "organization_id" text;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_share_active_chat_id_public_unique" ON "chat_share" ("chat_id") WHERE "deleted_at" IS NULL AND "organization_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "chat_share_active_chat_id_org_unique" ON "chat_share" ("chat_id","organization_id") WHERE "deleted_at" IS NULL AND "organization_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "chat_share_organization_id_idx" ON "chat_share" ("organization_id");--> statement-breakpoint
ALTER TABLE "chat_share" ADD CONSTRAINT "chat_share_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;