-- Routing telemetry indexes, for building out-of-band against production.
--
-- WHY THIS IS NOT A MIGRATION
-- Drizzle's migrator wraps every pending migration in a single transaction
-- (drizzle-orm pg-core dialect: `session.transaction(...)` around the whole
-- batch). `CREATE INDEX CONCURRENTLY` is rejected inside a transaction block, so
-- it can only be run by hand like this.
--
-- WHEN TO RUN IT
-- Optional. `1786134059_previous_tombstone.sql` creates the same four indexes with
-- `IF NOT EXISTS`, so if you let the normal migration do it, that is fine — the
-- tables are created empty by `1786134049_familiar_darkstar.sql`, so a plain
-- `CREATE INDEX` on them takes an exclusive lock on a table with no rows and
-- nothing to scan. Run this script instead when you want the index build fully
-- decoupled from the deploy, e.g. because the tables have already accumulated
-- rows from an earlier deploy of the worker.
--
-- HOW TO RUN IT
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f routing-telemetry-indexes.sql
--
-- Run it one statement at a time, not inside a transaction. Each statement is
-- idempotent, so a re-run after a failure is safe.
--
-- IF A BUILD FAILS
-- A failed `CREATE INDEX CONCURRENTLY` leaves an INVALID index behind, and
-- `IF NOT EXISTS` will then skip it forever while the planner ignores it. Check
-- for that before assuming the index exists:
--
--   SELECT i.indexrelid::regclass AS index, i.indisvalid
--   FROM pg_index i
--   WHERE i.indexrelid::regclass::text LIKE 'routing_%';
--
-- Drop any row with indisvalid = false and re-run:
--   DROP INDEX CONCURRENTLY "<index name>";

CREATE INDEX CONCURRENTLY IF NOT EXISTS "routing_election_hourly_model_ts_idx"
	ON "routing_election_hourly" ("model_id", "hour_timestamp");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "routing_election_hourly_ts_idx"
	ON "routing_election_hourly" ("hour_timestamp");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "routing_exclusion_hourly_model_ts_idx"
	ON "routing_exclusion_hourly" ("model_id", "hour_timestamp");

CREATE INDEX CONCURRENTLY IF NOT EXISTS "routing_exclusion_hourly_ts_reason_idx"
	ON "routing_exclusion_hourly" ("hour_timestamp", "reason");
