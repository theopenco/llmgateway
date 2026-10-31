ALTER TABLE "organization" ADD COLUMN "provider_key_alert_settings" json;--> statement-breakpoint
ALTER TABLE "provider_key_hourly_stats" ADD COLUMN "retried_gateway_error_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_key_hourly_stats" ADD COLUMN "retried_upstream_error_count" integer DEFAULT 0 NOT NULL;