CREATE TABLE "platform_webhook_delivery" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"webhook_endpoint_id" text NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_attempt_at" timestamp,
	"response_status" integer,
	"last_error" text
);
--> statement-breakpoint
CREATE TABLE "webhook_endpoint" (
	"id" text PRIMARY KEY,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"url" text NOT NULL,
	"secret" text NOT NULL,
	"enabled_events" json,
	"status" text DEFAULT 'active' NOT NULL
);
--> statement-breakpoint
CREATE INDEX "platform_webhook_delivery_status_next_attempt_idx" ON "platform_webhook_delivery" ("status","next_attempt_at") WHERE status = 'pending';--> statement-breakpoint
CREATE INDEX "platform_webhook_delivery_endpoint_id_idx" ON "platform_webhook_delivery" ("webhook_endpoint_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_project_id_idx" ON "webhook_endpoint" ("project_id");--> statement-breakpoint
CREATE INDEX "webhook_endpoint_organization_id_idx" ON "webhook_endpoint" ("organization_id");--> statement-breakpoint
ALTER TABLE "platform_webhook_delivery" ADD CONSTRAINT "platform_webhook_delivery_6o69dFuU5JAY_fkey" FOREIGN KEY ("webhook_endpoint_id") REFERENCES "webhook_endpoint"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_organization_id_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "webhook_endpoint" ADD CONSTRAINT "webhook_endpoint_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;