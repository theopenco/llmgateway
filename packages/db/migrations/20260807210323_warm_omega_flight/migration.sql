ALTER TABLE "global_model_stats" DROP CONSTRAINT "global_model_stats_day_timestamp_used_model_used_provider_unique";--> statement-breakpoint
ALTER TABLE "global_source_stats" DROP CONSTRAINT "global_source_stats_day_timestamp_source_unique";--> statement-breakpoint
ALTER TABLE "global_model_stats" ADD COLUMN "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "global_model_stats" ADD COLUMN "org_kind" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "global_source_stats" ADD COLUMN "used_mode" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "global_source_stats" ADD COLUMN "org_kind" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
-- Lossless attribution of pre-existing rows: when every request in a row used
-- the same mode, all of that row's measures belong to that mode. Genuinely
-- mixed rows keep 'unknown', as does org_kind on every pre-existing row —
-- recovering those means re-aggregating the raw logs, which is deliberately
-- not done here. Nothing is prorated.
UPDATE "global_model_stats" SET "used_mode" = 'credits' WHERE "credits_request_count" > 0 AND "api_keys_request_count" = 0;--> statement-breakpoint
UPDATE "global_model_stats" SET "used_mode" = 'api-keys' WHERE "api_keys_request_count" > 0 AND "credits_request_count" = 0;--> statement-breakpoint
UPDATE "global_source_stats" SET "used_mode" = 'credits' WHERE "credits_request_count" > 0 AND "api_keys_request_count" = 0;--> statement-breakpoint
UPDATE "global_source_stats" SET "used_mode" = 'api-keys' WHERE "api_keys_request_count" > 0 AND "credits_request_count" = 0;--> statement-breakpoint
ALTER TABLE "global_model_stats" ADD CONSTRAINT "global_model_stats_day_timestamp_used_model_used_provider_used_mode_org_kind_unique" UNIQUE("day_timestamp","used_model","used_provider","used_mode","org_kind");--> statement-breakpoint
ALTER TABLE "global_source_stats" ADD CONSTRAINT "global_source_stats_day_timestamp_source_used_mode_org_kind_unique" UNIQUE("day_timestamp","source","used_mode","org_kind");--> statement-breakpoint
ALTER TABLE "global_model_stats" DROP COLUMN "credits_request_count";--> statement-breakpoint
ALTER TABLE "global_model_stats" DROP COLUMN "api_keys_request_count";--> statement-breakpoint
ALTER TABLE "global_model_stats" DROP COLUMN "credits_cost";--> statement-breakpoint
ALTER TABLE "global_model_stats" DROP COLUMN "api_keys_cost";--> statement-breakpoint
ALTER TABLE "global_model_stats" DROP COLUMN "credits_data_storage_cost";--> statement-breakpoint
ALTER TABLE "global_model_stats" DROP COLUMN "api_keys_data_storage_cost";--> statement-breakpoint
ALTER TABLE "global_source_stats" DROP COLUMN "credits_request_count";--> statement-breakpoint
ALTER TABLE "global_source_stats" DROP COLUMN "api_keys_request_count";--> statement-breakpoint
ALTER TABLE "global_source_stats" DROP COLUMN "credits_cost";--> statement-breakpoint
ALTER TABLE "global_source_stats" DROP COLUMN "api_keys_cost";--> statement-breakpoint
ALTER TABLE "global_source_stats" DROP COLUMN "credits_data_storage_cost";--> statement-breakpoint
ALTER TABLE "global_source_stats" DROP COLUMN "api_keys_data_storage_cost";