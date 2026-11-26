CREATE TABLE "model_price_state" (
	"mapping_id" text PRIMARY KEY,
	"prices" json NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preference" ADD COLUMN "model_scope" text DEFAULT 'used' NOT NULL;--> statement-breakpoint
ALTER TABLE "notification_preference" ADD COLUMN "model_ids" json DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE "model_price_state" ADD CONSTRAINT "model_price_state_mapping_id_model_provider_mapping_id_fkey" FOREIGN KEY ("mapping_id") REFERENCES "model_provider_mapping"("id") ON DELETE CASCADE;