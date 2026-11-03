-- Widen the derived rollup money columns from real (float4) to double precision
-- (float8). Fixes theopenco/llmgateway#3630.
--
-- Why: SUM(real) returns real, so every hourly/daily/history bucket was rounded
-- when stored and a bare SUM() over the column accumulated in single precision,
-- which made independently grouped rollups drift apart. The raw `log` table
-- stays real (out of scope: high-volume, disruptive rewrite).
--
-- Grouping: drizzle-kit emits one ALTER COLUMN statement per column, which
-- rewrites a table once per column (up to 18x). The statements below are grouped
-- into one ALTER TABLE per table so each table is rewritten exactly once. The
-- snapshot is unchanged by the grouping; `pnpm migrations` re-runs with no diff.
--
-- LOCKING — read before deploying. real -> double precision is not
-- binary-coercible, so each ALTER TABLE rewrites the heap and rebuilds every
-- index on the table under an ACCESS EXCLUSIVE lock. `runMigrations()` goes
-- through drizzle's `migrate()`, which runs every pending migration inside ONE
-- transaction, so all 14 locks are held until the final commit: the blocking
-- window is the SUM of the 14 rewrites, not the longest one, and each table is
-- unreadable from the moment its ALTER starts.
--
-- Measured cost: ~42s for 1M rows / 560MB on project_hourly_model_stats
-- (18 money columns, 6 indexes) on Postgres 16; index rebuilds dominate.
--
-- `SET LOCAL lock_timeout` below bounds how long each ALTER WAITS for its lock,
-- so a deploy cannot queue behind a long analytics query and thereby block
-- every subsequent reader of that table. It does not bound the rewrite itself.
-- On timeout the whole transaction rolls back and the deploy fails; nothing is
-- half-applied, and a retry re-runs from the start.
--
-- OPS PREREQUISITE:
--   1. Measure the tables first:
--        SELECT relname, n_live_tup,
--               pg_size_pretty(pg_total_relation_size(relid)) AS total
--          FROM pg_stat_user_tables
--         WHERE relname IN (
--           'project_hourly_stats','project_hourly_model_stats',
--           'project_hourly_source_stats','api_key_hourly_stats',
--           'api_key_hourly_model_stats','provider_key_hourly_stats',
--           'global_model_stats','global_source_stats','model_history',
--           'model_history_hourly','model_provider_mapping_history',
--           'model_provider_mapping_history_hourly',
--           'global_hourly_model_stats','global_hourly_source_stats')
--         ORDER BY pg_total_relation_size(relid) DESC;
--   2. Deploy in a low-traffic window sized to the summed rewrite time. Only
--      analytics reads and the stats aggregator touch these tables; the
--      aggregator re-derives any bucket it could not upsert while locked.
--   3. If the measured total does not fit the window, take the offending
--      table's statement OUT of this file and move that column set to a
--      shadow-column backfill-and-swap run outside the deploy path. That
--      cannot be expressed inside this transaction.
--
-- ROLLBACK: the same statements with `real` instead of `double precision`.
-- That is a second full rewrite and rounds every value back to float4, so it
-- restores the type but not the pre-migration bytes.

SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE "api_key_hourly_model_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision USING "cost"::double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision USING "input_cost"::double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision USING "output_cost"::double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision USING "request_cost"::double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision USING "data_storage_cost"::double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision USING "discount_savings"::double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision USING "image_input_cost"::double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision USING "image_output_cost"::double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision USING "audio_input_cost"::double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision USING "audio_output_cost"::double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision USING "video_output_cost"::double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision USING "cached_input_cost"::double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision USING "cache_write_input_cost"::double precision,
	ALTER COLUMN "credits_cost" SET DATA TYPE double precision USING "credits_cost"::double precision,
	ALTER COLUMN "api_keys_cost" SET DATA TYPE double precision USING "api_keys_cost"::double precision,
	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE double precision USING "credits_data_storage_cost"::double precision,
	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE double precision USING "api_keys_data_storage_cost"::double precision;
--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision USING "cost"::double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision USING "input_cost"::double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision USING "output_cost"::double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision USING "request_cost"::double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision USING "data_storage_cost"::double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision USING "discount_savings"::double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision USING "image_input_cost"::double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision USING "image_output_cost"::double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision USING "audio_input_cost"::double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision USING "audio_output_cost"::double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision USING "video_output_cost"::double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision USING "cached_input_cost"::double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision USING "cache_write_input_cost"::double precision,
	ALTER COLUMN "credits_cost" SET DATA TYPE double precision USING "credits_cost"::double precision,
	ALTER COLUMN "api_keys_cost" SET DATA TYPE double precision USING "api_keys_cost"::double precision,
	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE double precision USING "credits_data_storage_cost"::double precision,
	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE double precision USING "api_keys_data_storage_cost"::double precision;
--> statement-breakpoint
ALTER TABLE "global_hourly_model_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision USING "cost"::double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision USING "input_cost"::double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision USING "output_cost"::double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision USING "request_cost"::double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision USING "data_storage_cost"::double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision USING "discount_savings"::double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision USING "image_input_cost"::double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision USING "image_output_cost"::double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision USING "audio_input_cost"::double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision USING "audio_output_cost"::double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision USING "video_output_cost"::double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision USING "cached_input_cost"::double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision USING "cache_write_input_cost"::double precision,
	ALTER COLUMN "provider_margin_amount" SET DATA TYPE double precision USING "provider_margin_amount"::double precision;
--> statement-breakpoint
ALTER TABLE "global_hourly_source_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision USING "cost"::double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision USING "input_cost"::double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision USING "output_cost"::double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision USING "request_cost"::double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision USING "data_storage_cost"::double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision USING "discount_savings"::double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision USING "image_input_cost"::double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision USING "image_output_cost"::double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision USING "audio_input_cost"::double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision USING "audio_output_cost"::double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision USING "video_output_cost"::double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision USING "cached_input_cost"::double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision USING "cache_write_input_cost"::double precision;
--> statement-breakpoint
ALTER TABLE "global_model_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision USING "cost"::double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision USING "input_cost"::double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision USING "output_cost"::double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision USING "request_cost"::double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision USING "data_storage_cost"::double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision USING "discount_savings"::double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision USING "image_input_cost"::double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision USING "image_output_cost"::double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision USING "audio_input_cost"::double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision USING "audio_output_cost"::double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision USING "video_output_cost"::double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision USING "cached_input_cost"::double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision USING "cache_write_input_cost"::double precision,
	ALTER COLUMN "provider_margin_amount" SET DATA TYPE double precision USING "provider_margin_amount"::double precision;
--> statement-breakpoint
ALTER TABLE "global_source_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision USING "cost"::double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision USING "input_cost"::double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision USING "output_cost"::double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision USING "request_cost"::double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision USING "data_storage_cost"::double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision USING "discount_savings"::double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision USING "image_input_cost"::double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision USING "image_output_cost"::double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision USING "audio_input_cost"::double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision USING "audio_output_cost"::double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision USING "video_output_cost"::double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision USING "cached_input_cost"::double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision USING "cache_write_input_cost"::double precision;
--> statement-breakpoint
ALTER TABLE "model_history"
	ALTER COLUMN "total_cost" SET DATA TYPE double precision USING "total_cost"::double precision,
	ALTER COLUMN "total_input_cost" SET DATA TYPE double precision USING "total_input_cost"::double precision,
	ALTER COLUMN "total_output_cost" SET DATA TYPE double precision USING "total_output_cost"::double precision,
	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE double precision USING "total_cached_input_cost"::double precision;
--> statement-breakpoint
ALTER TABLE "model_history_hourly"
	ALTER COLUMN "total_cost" SET DATA TYPE double precision USING "total_cost"::double precision,
	ALTER COLUMN "total_input_cost" SET DATA TYPE double precision USING "total_input_cost"::double precision,
	ALTER COLUMN "total_output_cost" SET DATA TYPE double precision USING "total_output_cost"::double precision,
	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE double precision USING "total_cached_input_cost"::double precision;
--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history"
	ALTER COLUMN "total_cost" SET DATA TYPE double precision USING "total_cost"::double precision,
	ALTER COLUMN "total_input_cost" SET DATA TYPE double precision USING "total_input_cost"::double precision,
	ALTER COLUMN "total_output_cost" SET DATA TYPE double precision USING "total_output_cost"::double precision,
	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE double precision USING "total_cached_input_cost"::double precision;
--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly"
	ALTER COLUMN "total_cost" SET DATA TYPE double precision USING "total_cost"::double precision,
	ALTER COLUMN "total_input_cost" SET DATA TYPE double precision USING "total_input_cost"::double precision,
	ALTER COLUMN "total_output_cost" SET DATA TYPE double precision USING "total_output_cost"::double precision,
	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE double precision USING "total_cached_input_cost"::double precision;
--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision USING "cost"::double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision USING "input_cost"::double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision USING "output_cost"::double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision USING "request_cost"::double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision USING "data_storage_cost"::double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision USING "discount_savings"::double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision USING "image_input_cost"::double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision USING "image_output_cost"::double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision USING "audio_input_cost"::double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision USING "audio_output_cost"::double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision USING "video_output_cost"::double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision USING "cached_input_cost"::double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision USING "cache_write_input_cost"::double precision,
	ALTER COLUMN "provider_margin_amount" SET DATA TYPE double precision USING "provider_margin_amount"::double precision,
	ALTER COLUMN "credits_cost" SET DATA TYPE double precision USING "credits_cost"::double precision,
	ALTER COLUMN "api_keys_cost" SET DATA TYPE double precision USING "api_keys_cost"::double precision,
	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE double precision USING "credits_data_storage_cost"::double precision,
	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE double precision USING "api_keys_data_storage_cost"::double precision;
--> statement-breakpoint
ALTER TABLE "project_hourly_source_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision USING "cost"::double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision USING "input_cost"::double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision USING "output_cost"::double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision USING "request_cost"::double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision USING "data_storage_cost"::double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision USING "discount_savings"::double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision USING "image_input_cost"::double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision USING "image_output_cost"::double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision USING "audio_input_cost"::double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision USING "audio_output_cost"::double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision USING "video_output_cost"::double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision USING "cached_input_cost"::double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision USING "cache_write_input_cost"::double precision,
	ALTER COLUMN "credits_cost" SET DATA TYPE double precision USING "credits_cost"::double precision,
	ALTER COLUMN "api_keys_cost" SET DATA TYPE double precision USING "api_keys_cost"::double precision,
	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE double precision USING "credits_data_storage_cost"::double precision,
	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE double precision USING "api_keys_data_storage_cost"::double precision;
--> statement-breakpoint
ALTER TABLE "project_hourly_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision USING "cost"::double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision USING "input_cost"::double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision USING "output_cost"::double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision USING "request_cost"::double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision USING "data_storage_cost"::double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision USING "discount_savings"::double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision USING "image_input_cost"::double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision USING "image_output_cost"::double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision USING "audio_input_cost"::double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision USING "audio_output_cost"::double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision USING "video_output_cost"::double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision USING "cached_input_cost"::double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision USING "cache_write_input_cost"::double precision,
	ALTER COLUMN "credits_cost" SET DATA TYPE double precision USING "credits_cost"::double precision,
	ALTER COLUMN "api_keys_cost" SET DATA TYPE double precision USING "api_keys_cost"::double precision,
	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE double precision USING "credits_data_storage_cost"::double precision,
	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE double precision USING "api_keys_data_storage_cost"::double precision;
--> statement-breakpoint
ALTER TABLE "provider_key_hourly_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision USING "cost"::double precision;
