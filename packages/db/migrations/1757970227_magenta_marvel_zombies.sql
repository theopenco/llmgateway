ALTER TABLE "model" ADD COLUMN "client_errors_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "gateway_errors_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "upstream_errors_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model" ADD COLUMN "cached_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_history" ADD COLUMN "cached_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "client_errors_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "gateway_errors_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "upstream_errors_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping" ADD COLUMN "cached_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" ADD COLUMN "cached_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "client_errors_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "gateway_errors_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "upstream_errors_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "provider" ADD COLUMN "cached_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "model" DROP COLUMN "throughput";--> statement-breakpoint
ALTER TABLE "model_history" DROP COLUMN "throughput";--> statement-breakpoint
ALTER TABLE "model_provider_mapping" DROP COLUMN "throughput";--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history" DROP COLUMN "throughput";--> statement-breakpoint
ALTER TABLE "provider" DROP COLUMN "throughput";