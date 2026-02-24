CREATE TABLE "follow_up_email" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"email_type" text NOT NULL,
	"sent_to" text NOT NULL,
	CONSTRAINT "follow_up_email_organization_id_email_type_unique" UNIQUE("organization_id","email_type")
);
--> statement-breakpoint
CREATE INDEX "follow_up_email_organization_id_idx" ON "follow_up_email" ("organization_id");--> statement-breakpoint
ALTER TABLE "follow_up_email" ADD CONSTRAINT "follow_up_email_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "api_key_hourly_model_stats" DROP COLUMN "service_fee";--> statement-breakpoint
ALTER TABLE "api_key_hourly_model_stats" DROP COLUMN "credits_service_fee";--> statement-breakpoint
ALTER TABLE "api_key_hourly_model_stats" DROP COLUMN "api_keys_service_fee";--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats" DROP COLUMN "service_fee";--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats" DROP COLUMN "credits_service_fee";--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats" DROP COLUMN "api_keys_service_fee";--> statement-breakpoint
ALTER TABLE "log" DROP COLUMN "service_fee";--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" DROP COLUMN "service_fee";--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" DROP COLUMN "credits_service_fee";--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats" DROP COLUMN "api_keys_service_fee";--> statement-breakpoint
ALTER TABLE "project_hourly_stats" DROP COLUMN "service_fee";--> statement-breakpoint
ALTER TABLE "project_hourly_stats" DROP COLUMN "credits_service_fee";--> statement-breakpoint
ALTER TABLE "project_hourly_stats" DROP COLUMN "api_keys_service_fee";