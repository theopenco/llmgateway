-- IF EXISTS: 1785101538_kind_tomorrow_man.sql no longer creates these, so on a
-- database that has not applied it yet there is nothing to drop. Environments
-- that applied the original version still get them cleaned up here.
DROP INDEX IF EXISTS "log_realtime_session_usage_key_unique";--> statement-breakpoint
DROP INDEX IF EXISTS "log_realtime_unsettled_organization_id_idx";
