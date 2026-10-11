DROP INDEX "end_customer_project_id_external_id_unique";--> statement-breakpoint
ALTER TABLE "end_customer" ADD COLUMN "mode" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "wallet" ADD COLUMN "mode" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "end_customer_project_id_external_id_unique" ON "end_customer" ("project_id","external_id","mode");