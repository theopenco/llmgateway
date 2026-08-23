-- Migrate derived analytical rollup cost columns from real (float4) to
-- double precision (float8). Fixes theopenco/llmgateway#3630.
--
-- Why: SUM(real) returns real, so every hourly/daily/history bucket is rounded
-- when stored and bare SUM() over these columns accumulates in single
-- precision. Widening the storage type removes the per-bucket rounding and lets
-- a bare SUM() accumulate in double precision.
--
-- IMPORTANT — table rewrite. real -> double precision is NOT binary-coercible,
-- so each ALTER COLUMN TYPE rewrites the whole table under an ACCESS EXCLUSIVE
-- lock. The per-column statements drizzle-kit generates would rewrite each
-- table once PER column (up to 17x). They are grouped below into a single
-- ALTER TABLE per table so every table is rewritten exactly ONCE. The schema
-- snapshot is unchanged by this grouping; a re-run of `pnpm migrations`
-- produces no diff.
--
-- ROLLOUT (production):
--   1. Before deploying, measure each table's row count and size:
--        SELECT relname, n_live_tup,
--               pg_size_pretty(pg_total_relation_size(relid)) AS total
--          FROM pg_stat_user_tables
--         WHERE relname IN (
--           'project_hourly_stats','project_hourly_model_stats',
--           'project_hourly_source_stats','api_key_hourly_stats',
--           'api_key_hourly_model_stats','provider_key_hourly_stats',
--           'global_model_stats','global_source_stats','model_history',
--           'model_history_hourly','model_provider_mapping_history',
--           'model_provider_mapping_history_hourly')
--         ORDER BY pg_total_relation_size(relid) DESC;
--   2. Each grouped ALTER takes an ACCESS EXCLUSIVE lock and rewrites the
--      table. These are hourly/daily rollup tables (small relative to `log`),
--      so a direct rewrite is expected to be acceptable in a low-traffic
--      window with a bounded lock_timeout, e.g. per statement:
--        SET lock_timeout = '5s';
--      Run in a maintenance window; the aggregation worker re-derives any
--      bucket it could not upsert while the lock was held.
--   3. For any table whose measured size makes a blocking rewrite
--      unacceptable, do NOT run its statement here: instead add a nullable
--      shadow column of type double precision, backfill in batches, then swap
--      names in a short transaction (shadow-table / backfill-and-swap). No
--      such table is expected among these rollups; this is the escape hatch.
--
-- ROLLBACK:
--   Narrowing back to real is a second full rewrite and LOSES precision gained
--   since this migration (float8 values are rounded to float4). It restores the
--   type but not the old bytes. Down SQL, symmetric to the up statements:
--   ALTER TABLE "api_key_hourly_model_stats"
--   	ALTER COLUMN "cost" SET DATA TYPE real,
--   	ALTER COLUMN "input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "request_cost" SET DATA TYPE real,
--   	ALTER COLUMN "data_storage_cost" SET DATA TYPE real,
--   	ALTER COLUMN "discount_savings" SET DATA TYPE real,
--   	ALTER COLUMN "image_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "image_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "video_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cached_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "credits_cost" SET DATA TYPE real,
--   	ALTER COLUMN "api_keys_cost" SET DATA TYPE real,
--   	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE real,
--   	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE real;
--
--   ALTER TABLE "api_key_hourly_stats"
--   	ALTER COLUMN "cost" SET DATA TYPE real,
--   	ALTER COLUMN "input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "request_cost" SET DATA TYPE real,
--   	ALTER COLUMN "data_storage_cost" SET DATA TYPE real,
--   	ALTER COLUMN "discount_savings" SET DATA TYPE real,
--   	ALTER COLUMN "image_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "image_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "video_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cached_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "credits_cost" SET DATA TYPE real,
--   	ALTER COLUMN "api_keys_cost" SET DATA TYPE real,
--   	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE real,
--   	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE real;
--
--   ALTER TABLE "global_model_stats"
--   	ALTER COLUMN "cost" SET DATA TYPE real,
--   	ALTER COLUMN "input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "request_cost" SET DATA TYPE real,
--   	ALTER COLUMN "data_storage_cost" SET DATA TYPE real,
--   	ALTER COLUMN "discount_savings" SET DATA TYPE real,
--   	ALTER COLUMN "image_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "image_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "video_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cached_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE real;
--
--   ALTER TABLE "global_source_stats"
--   	ALTER COLUMN "cost" SET DATA TYPE real,
--   	ALTER COLUMN "input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "request_cost" SET DATA TYPE real,
--   	ALTER COLUMN "data_storage_cost" SET DATA TYPE real,
--   	ALTER COLUMN "discount_savings" SET DATA TYPE real,
--   	ALTER COLUMN "image_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "image_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "video_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cached_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE real;
--
--   ALTER TABLE "model_history"
--   	ALTER COLUMN "total_cost" SET DATA TYPE real,
--   	ALTER COLUMN "total_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "total_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE real;
--
--   ALTER TABLE "model_history_hourly"
--   	ALTER COLUMN "total_cost" SET DATA TYPE real,
--   	ALTER COLUMN "total_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "total_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE real;
--
--   ALTER TABLE "model_provider_mapping_history"
--   	ALTER COLUMN "total_cost" SET DATA TYPE real,
--   	ALTER COLUMN "total_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "total_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE real;
--
--   ALTER TABLE "model_provider_mapping_history_hourly"
--   	ALTER COLUMN "total_cost" SET DATA TYPE real,
--   	ALTER COLUMN "total_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "total_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE real;
--
--   ALTER TABLE "project_hourly_model_stats"
--   	ALTER COLUMN "cost" SET DATA TYPE real,
--   	ALTER COLUMN "input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "request_cost" SET DATA TYPE real,
--   	ALTER COLUMN "data_storage_cost" SET DATA TYPE real,
--   	ALTER COLUMN "discount_savings" SET DATA TYPE real,
--   	ALTER COLUMN "image_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "image_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "video_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cached_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "credits_cost" SET DATA TYPE real,
--   	ALTER COLUMN "api_keys_cost" SET DATA TYPE real,
--   	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE real,
--   	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE real;
--
--   ALTER TABLE "project_hourly_source_stats"
--   	ALTER COLUMN "cost" SET DATA TYPE real,
--   	ALTER COLUMN "input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "request_cost" SET DATA TYPE real,
--   	ALTER COLUMN "data_storage_cost" SET DATA TYPE real,
--   	ALTER COLUMN "discount_savings" SET DATA TYPE real,
--   	ALTER COLUMN "image_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "image_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "video_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cached_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "credits_cost" SET DATA TYPE real,
--   	ALTER COLUMN "api_keys_cost" SET DATA TYPE real,
--   	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE real,
--   	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE real;
--
--   ALTER TABLE "project_hourly_stats"
--   	ALTER COLUMN "cost" SET DATA TYPE real,
--   	ALTER COLUMN "input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "request_cost" SET DATA TYPE real,
--   	ALTER COLUMN "data_storage_cost" SET DATA TYPE real,
--   	ALTER COLUMN "discount_savings" SET DATA TYPE real,
--   	ALTER COLUMN "image_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "image_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "audio_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "video_output_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cached_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE real,
--   	ALTER COLUMN "credits_cost" SET DATA TYPE real,
--   	ALTER COLUMN "api_keys_cost" SET DATA TYPE real,
--   	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE real,
--   	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE real;
--
--   ALTER TABLE "provider_key_hourly_stats"
--   	ALTER COLUMN "cost" SET DATA TYPE real;

ALTER TABLE "api_key_hourly_model_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "credits_cost" SET DATA TYPE double precision,
	ALTER COLUMN "api_keys_cost" SET DATA TYPE double precision,
	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE double precision,
	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "api_key_hourly_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "credits_cost" SET DATA TYPE double precision,
	ALTER COLUMN "api_keys_cost" SET DATA TYPE double precision,
	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE double precision,
	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "global_model_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "global_source_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "model_history"
	ALTER COLUMN "total_cost" SET DATA TYPE double precision,
	ALTER COLUMN "total_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "total_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "model_history_hourly"
	ALTER COLUMN "total_cost" SET DATA TYPE double precision,
	ALTER COLUMN "total_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "total_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history"
	ALTER COLUMN "total_cost" SET DATA TYPE double precision,
	ALTER COLUMN "total_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "total_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "model_provider_mapping_history_hourly"
	ALTER COLUMN "total_cost" SET DATA TYPE double precision,
	ALTER COLUMN "total_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "total_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "project_hourly_model_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "credits_cost" SET DATA TYPE double precision,
	ALTER COLUMN "api_keys_cost" SET DATA TYPE double precision,
	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE double precision,
	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "project_hourly_source_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "credits_cost" SET DATA TYPE double precision,
	ALTER COLUMN "api_keys_cost" SET DATA TYPE double precision,
	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE double precision,
	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "project_hourly_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision,
	ALTER COLUMN "input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "request_cost" SET DATA TYPE double precision,
	ALTER COLUMN "data_storage_cost" SET DATA TYPE double precision,
	ALTER COLUMN "discount_savings" SET DATA TYPE double precision,
	ALTER COLUMN "image_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "image_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "audio_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "video_output_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cached_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "cache_write_input_cost" SET DATA TYPE double precision,
	ALTER COLUMN "credits_cost" SET DATA TYPE double precision,
	ALTER COLUMN "api_keys_cost" SET DATA TYPE double precision,
	ALTER COLUMN "credits_data_storage_cost" SET DATA TYPE double precision,
	ALTER COLUMN "api_keys_data_storage_cost" SET DATA TYPE double precision;--> statement-breakpoint
ALTER TABLE "provider_key_hourly_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision;
