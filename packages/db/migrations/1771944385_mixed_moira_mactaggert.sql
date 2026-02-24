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