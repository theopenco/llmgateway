-- Internal content-filter classifier latency by scope, last 48 hours.
--
-- Purpose:
-- Compare how long the internal classifier itself takes when it reads the
-- whole conversation ('full') versus only the latest turn ('latest_turn').
-- The image moderation delegated to OpenAI is excluded and reported in its
-- own columns.
--
-- Data source:
-- - content_filter_hourly_latency_stats: one row per hour, classifier and
--   internal scope, platform wide. No `log` scan.
--
-- Notes:
-- - Sums, counts and maxima are exact. Percentiles are stored per hour and do
--   not combine across hours: p50/p95/p99 here are the hourly values weighted
--   by check count, and worst_hour_p95_ms is the slowest single hour. For an
--   exact percentile, read one hour's row or query
--   log.gateway_content_filter_evaluation->>'classifierDurationMs'.
-- - Only checks that recorded classifierDurationMs are counted, so hours
--   before that field shipped have no rows.
-- - hour_timestamp is UTC without a time zone, hence the UTC cutoff.
-- - The current hour is partial until the stats worker next recounts it.
-- - avg_classify_calls is classify calls per check: a long conversation is
--   sent in chunks, up to 8 at a time.
--
-- Tuning:
-- - Change interval '48 hours' to adjust the lookback window.
-- - Add hour_timestamp to the select and group by for a timeline, e.g. to
--   see the moment the scope setting was switched.

select
	internal_scope,
	sum(check_count)                                                       as checks,
	min(hour_timestamp)                                                    as first_hour,
	max(hour_timestamp)                                                    as last_hour,
	round(sum(classifier_duration_sum_ms)::numeric / nullif(sum(check_count), 0), 1) as avg_ms,
	round(sum(classifier_duration_p50_ms::numeric * check_count) / nullif(sum(check_count), 0), 1) as p50_ms,
	round(sum(classifier_duration_p95_ms::numeric * check_count) / nullif(sum(check_count), 0), 1) as p95_ms,
	round(sum(classifier_duration_p99_ms::numeric * check_count) / nullif(sum(check_count), 0), 1) as p99_ms,
	max(classifier_duration_p95_ms)                                        as worst_hour_p95_ms,
	max(classifier_duration_max_ms)                                        as max_ms,
	round(sum(classifier_request_sum)::numeric / nullif(sum(check_count), 0), 2) as avg_classify_calls,
	round(100.0 * sum(failed_count) / nullif(sum(check_count), 0), 2)      as failed_pct,
	sum(image_check_count)                                                 as image_checks,
	round(sum(image_duration_sum_ms)::numeric / nullif(sum(image_check_count), 0), 1) as avg_image_ms,
	max(image_duration_p95_ms)                                             as worst_hour_p95_image_ms
from content_filter_hourly_latency_stats
where classifier = 'internal'
	and hour_timestamp >= (now() at time zone 'UTC') - interval '48 hours'
group by internal_scope
order by internal_scope;
