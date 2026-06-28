-- The existing `service_tier` column stored the tier the provider actually
-- served, so rename it in place to `used_service_tier` to preserve that data
-- without an expensive backfill (RENAME COLUMN is a catalog-only operation,
-- instant regardless of table size). The newly added `requested_service_tier`
-- is left NULL for historical rows since the requested tier was not recorded
-- before this migration.
ALTER TABLE "log" RENAME COLUMN "service_tier" TO "used_service_tier";--> statement-breakpoint
ALTER TABLE "log" ADD COLUMN "requested_service_tier" text;
