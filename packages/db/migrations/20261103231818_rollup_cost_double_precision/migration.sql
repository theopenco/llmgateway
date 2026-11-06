-- Requires an approved maintenance window before deployment: pause rollup readers
-- and writers, drain long transactions, and budget rewrite/index/WAL capacity.
-- Each table rewrites once; all 14 ACCESS EXCLUSIVE locks persist until commit.
-- Existing float4-rounded history is preserved, not repaired. Roll back the app,
-- not these types: previous releases read/write compatible JavaScript numbers.

-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
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
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
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
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
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
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
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
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
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
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
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
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
ALTER TABLE "model_history"
	ALTER COLUMN "total_cost" SET DATA TYPE double precision USING "total_cost"::double precision,
	ALTER COLUMN "total_input_cost" SET DATA TYPE double precision USING "total_input_cost"::double precision,
	ALTER COLUMN "total_output_cost" SET DATA TYPE double precision USING "total_output_cost"::double precision,
	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE double precision USING "total_cached_input_cost"::double precision;
--> statement-breakpoint
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
ALTER TABLE "model_history_hourly"
	ALTER COLUMN "total_cost" SET DATA TYPE double precision USING "total_cost"::double precision,
	ALTER COLUMN "total_input_cost" SET DATA TYPE double precision USING "total_input_cost"::double precision,
	ALTER COLUMN "total_output_cost" SET DATA TYPE double precision USING "total_output_cost"::double precision,
	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE double precision USING "total_cached_input_cost"::double precision;
--> statement-breakpoint
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
ALTER TABLE "model_provider_mapping_history"
	ALTER COLUMN "total_cost" SET DATA TYPE double precision USING "total_cost"::double precision,
	ALTER COLUMN "total_input_cost" SET DATA TYPE double precision USING "total_input_cost"::double precision,
	ALTER COLUMN "total_output_cost" SET DATA TYPE double precision USING "total_output_cost"::double precision,
	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE double precision USING "total_cached_input_cost"::double precision;
--> statement-breakpoint
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
ALTER TABLE "model_provider_mapping_history_hourly"
	ALTER COLUMN "total_cost" SET DATA TYPE double precision USING "total_cost"::double precision,
	ALTER COLUMN "total_input_cost" SET DATA TYPE double precision USING "total_input_cost"::double precision,
	ALTER COLUMN "total_output_cost" SET DATA TYPE double precision USING "total_output_cost"::double precision,
	ALTER COLUMN "total_cached_input_cost" SET DATA TYPE double precision USING "total_cached_input_cost"::double precision;
--> statement-breakpoint
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
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
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
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
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
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
-- migrate:reviewed Previous writers remain compatible; deploy only in the approved maintenance window with rollup traffic quiesced and rewrite capacity checked.
ALTER TABLE "provider_key_hourly_stats"
	ALTER COLUMN "cost" SET DATA TYPE double precision USING "cost"::double precision;
