ALTER TABLE "video_job" ADD COLUMN "provider_margin_percent" real;--> statement-breakpoint
ALTER TABLE "video_job" ADD COLUMN "provider_discount_percent" real;--> statement-breakpoint
UPDATE "video_job"
SET
	"provider_margin_percent" = "provider_routing_settings"."margin_percent"::real,
	"provider_discount_percent" = "provider_routing_settings"."discount_percent"::real
FROM "provider_routing_settings"
WHERE
	"video_job"."used_provider" = "provider_routing_settings"."provider_id"
	AND "video_job"."log_id" IS NULL;
