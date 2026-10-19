-- Internal content-filter classifier flag rate by scope, last 48 hours.
--
-- Purpose:
-- Compare how often the internal classifier finds a violation when it reads
-- the whole conversation ('full') versus only the latest turn ('latest_turn').
-- Pair with internal_classifier_latency_by_scope_last_48_hours.sql for speed.
--
-- Data source:
-- - content_filter_hourly_stats: the category = 'all' rows carry the sampled,
--   violation and blocked totals per org, project, classifier and scope.
--   No `log` scan.
--
-- Notes:
-- - Counts are exact and sum across hours and orgs.
-- - sampled excludes checks whose moderation call failed.
-- - Rows written before the scope was recorded have internal_scope = ''.
-- - hour_timestamp is UTC without a time zone, hence the UTC cutoff.
-- - The current hour is partial until the stats worker next recounts it.
--
-- Tuning:
-- - Change interval '48 hours' to adjust the lookback window.
-- - Drop the category filter and group by category for a per-category split.

select
	internal_scope,
	sum(sampled_count)                                                     as sampled,
	sum(violation_count)                                                   as violations,
	sum(blocked_count)                                                     as blocked,
	round(100.0 * sum(violation_count) / nullif(sum(sampled_count), 0), 3) as violation_pct,
	round(100.0 * sum(blocked_count) / nullif(sum(sampled_count), 0), 3)   as blocked_pct,
	count(distinct organization_id)                                        as organizations,
	min(hour_timestamp)                                                    as first_hour,
	max(hour_timestamp)                                                    as last_hour
from content_filter_hourly_stats
where classifier = 'internal'
	and role = 'deciding'
	and category = 'all'
	and hour_timestamp >= (now() at time zone 'UTC') - interval '48 hours'
group by internal_scope
order by internal_scope;
