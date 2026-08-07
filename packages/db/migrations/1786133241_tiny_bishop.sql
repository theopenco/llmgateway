-- Adapted from the generated statements: `IF NOT EXISTS` added so this is a
-- no-op wherever the indexes were already built out-of-band with
-- `CREATE INDEX CONCURRENTLY` (see migrations/manual/routing-telemetry-indexes.sql).
-- Drizzle runs every pending migration inside one transaction, so CONCURRENTLY
-- cannot be used here — it is only valid outside a transaction block.
CREATE INDEX IF NOT EXISTS "routing_election_hourly_model_ts_idx" ON "routing_election_hourly" ("model_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_election_hourly_ts_idx" ON "routing_election_hourly" ("hour_timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_exclusion_hourly_model_ts_idx" ON "routing_exclusion_hourly" ("model_id","hour_timestamp");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "routing_exclusion_hourly_ts_reason_idx" ON "routing_exclusion_hourly" ("hour_timestamp","reason");
