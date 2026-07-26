ALTER TABLE "provider_key" ADD COLUMN "sort_order" integer;--> statement-breakpoint
CREATE INDEX "provider_key_sort_order_idx" ON "provider_key" ("organization_id","provider","sort_order");