CREATE TABLE "routing_config" (
	"id" text PRIMARY KEY,
	"project_id" text NOT NULL UNIQUE,
	"enabled" boolean DEFAULT false NOT NULL,
	"weights" jsonb,
	"thresholds" jsonb,
	"retry" jsonb,
	"timeouts" jsonb,
	"history" jsonb,
	"sticky" jsonb,
	"provider_priorities" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "routing_config_project_id_idx" ON "routing_config" ("project_id");--> statement-breakpoint
ALTER TABLE "routing_config" ADD CONSTRAINT "routing_config_project_id_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" DROP COLUMN "routing_uptime";--> statement-breakpoint
ALTER TABLE "model_provider_mapping" DROP COLUMN "routing_latency";--> statement-breakpoint
ALTER TABLE "model_provider_mapping" DROP COLUMN "routing_throughput";--> statement-breakpoint
ALTER TABLE "model_provider_mapping" DROP COLUMN "routing_total_requests";