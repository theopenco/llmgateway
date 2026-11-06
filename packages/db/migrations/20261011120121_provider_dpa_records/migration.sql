ALTER TABLE "provider" ADD COLUMN "dpa_signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "dpa_signed_by" text;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "dpa_note" text;