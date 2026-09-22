CREATE TABLE "compliance_alert_recipient" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	CONSTRAINT "compliance_alert_recipient_organization_id_user_id_unique" UNIQUE("organization_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "compliance_provider_state" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"compliant" boolean NOT NULL,
	"failures" json NOT NULL,
	"policy_hash" text NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "compliance_provider_state_organization_id_provider_id_unique" UNIQUE("organization_id","provider_id")
);
--> statement-breakpoint
CREATE TABLE "model_availability_watch" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"model_id" text NOT NULL,
	"created_by_user_id" text,
	"available_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "model_availability_watch_organization_id_model_id_unique" UNIQUE("organization_id","model_id")
);
--> statement-breakpoint
CREATE TABLE "organization_alert" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"event_key" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"href" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_alert_organization_id_event_key_unique" UNIQUE("organization_id","event_key")
);
--> statement-breakpoint
CREATE TABLE "organization_alert_delivery" (
	"id" text PRIMARY KEY,
	"alert_id" text NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"sent_at" timestamp,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "organization_alert_delivery_alert_id_kind_unique" UNIQUE("alert_id","kind")
);
--> statement-breakpoint
CREATE TABLE "organization_notification_channel" (
	"id" text PRIMARY KEY,
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"config" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "organization_notification_channel_organization_id_kind_unique" UNIQUE("organization_id","kind")
);
--> statement-breakpoint
ALTER TABLE "notification" ADD COLUMN "organization_id" text;--> statement-breakpoint
ALTER TABLE "organization" ADD COLUMN "compliance_alert_settings" json;--> statement-breakpoint
ALTER TABLE "notification" ALTER COLUMN "project_id" DROP NOT NULL;--> statement-breakpoint
CREATE INDEX "organization_alert_delivery_pending_idx" ON "organization_alert_delivery" ("created_at") WHERE "sent_at" IS NULL;--> statement-breakpoint
ALTER TABLE "compliance_alert_recipient" ADD CONSTRAINT "compliance_alert_recipient_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "compliance_alert_recipient" ADD CONSTRAINT "compliance_alert_recipient_user_id_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "compliance_provider_state" ADD CONSTRAINT "compliance_provider_state_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "model_availability_watch" ADD CONSTRAINT "model_availability_watch_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "model_availability_watch" ADD CONSTRAINT "model_availability_watch_created_by_user_id_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "user"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "notification" ADD CONSTRAINT "notification_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_alert" ADD CONSTRAINT "organization_alert_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_alert_delivery" ADD CONSTRAINT "organization_alert_delivery_alert_id_organization_alert_id_fkey" FOREIGN KEY ("alert_id") REFERENCES "organization_alert"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "organization_notification_channel" ADD CONSTRAINT "organization_notification_channel_ybQrWLVXKeol_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;