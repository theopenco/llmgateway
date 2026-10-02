-- Internal content-filter classifier latency by scope, last 48 hours.
--
-- Purpose:
-- Compare how long the internal classifier itself takes when it reads the
-- whole conversation ('full') versus only the latest turn ('latest_turn').
-- The image moderation delegated to OpenAI is excluded and reported in its
-- own columns.
--
-- Data source:
-- - log.gateway_content_filter_evaluation: content_filter_hourly_stats only
--   holds the combined duration, with no scope dimension and no percentiles.
--
-- Notes:
-- - classifierDurationMs is the text classifier alone; imageDurationMs is the
--   OpenAI image call, present only when images were delegated (failed calls
--   included); durationMs is the whole check.
-- - Evaluations written before classifierDurationMs existed are left out.
-- - classifierRequests is the number of classify calls: a long conversation
--   is sent in chunks, up to 8 at a time.
-- - Retries copy the evaluation onto every attempt, hence distinct on
--   request_id.
--
-- Tuning:
-- - Change interval '48 hours' to adjust the lookback window.
-- - Add date_trunc('hour', created_at) to the select and group by for a
--   timeline, e.g. to see the moment the scope setting was switched.

with evaluations as (
	select distinct on (request_id)
		created_at,
		coalesce(e->>'internalScope', 'full')       as internal_scope,
		(e->>'classifierDurationMs')::numeric       as classifier_ms,
		(e->>'classifierRequests')::int             as classifier_requests,
		(e->>'imageDurationMs')::numeric            as image_ms,
		coalesce((e->>'moderationFailed')::boolean, false) as moderation_failed,
		prompt_tokens
	from log
	cross join lateral (select gateway_content_filter_evaluation as e) as evaluation
	where created_at >= now() - interval '48 hours'
		and e->>'classifier' = 'internal'
		and e ? 'classifierDurationMs'
	order by request_id, created_at
)
select
	internal_scope,
	count(*)                                                         as requests,
	min(created_at)                                                  as first_seen,
	max(created_at)                                                  as last_seen,
	round(avg(classifier_ms), 1)                                     as avg_ms,
	percentile_cont(0.5)  within group (order by classifier_ms)      as p50_ms,
	percentile_cont(0.95) within group (order by classifier_ms)      as p95_ms,
	percentile_cont(0.99) within group (order by classifier_ms)      as p99_ms,
	max(classifier_ms)                                               as max_ms,
	round(avg(classifier_requests), 2)                               as avg_classify_calls,
	max(classifier_requests)                                         as max_classify_calls,
	round(avg(prompt_tokens))                                        as avg_prompt_tokens,
	round(100.0 * count(*) filter (where moderation_failed) / count(*), 2) as failed_pct,
	count(image_ms)                                                  as image_requests,
	round(avg(image_ms), 1)                                          as avg_image_ms,
	percentile_cont(0.95) within group (order by image_ms)           as p95_image_ms
from evaluations
group by internal_scope
order by internal_scope;
