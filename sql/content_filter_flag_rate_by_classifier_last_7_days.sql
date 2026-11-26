-- Content filter flag rate and violation reasons per classifier, last 7 days.
--
-- Purpose:
-- Compare moderation classifiers (OpenAI moderation, Jev, the internal
-- classifier) on flag rate and violation categories. Shadow classifiers score
-- the same sampled requests as the deciding one, so grouping by classifier
-- compares them side by side; across days with different setups the rates
-- still group by the classifier that produced them.
--
-- Data source:
-- - content_filter_hourly_stats: category = 'all' rows carry sampled,
--   violation and blocked totals; category rows carry violation counts. Both
--   roles ('deciding', 'shadow') are counted. No `log` scan.
--
-- Notes:
-- - sampled excludes checks whose moderation call failed.
-- - blocked is only ever set on deciding rows.
-- - internal_scope splits the internal classifier by the input it read.
-- - hour_timestamp is UTC without a time zone, hence the UTC cutoff.
--
-- Tuning:
-- - Change interval '7 days' to adjust the lookback window.
-- - Drop day from both queries for whole-window totals.

-- Flag rate per day and classifier.
select
	date_trunc('day', hour_timestamp)                                      as day,
	classifier,
	internal_scope,
	sum(sampled_count)                                                     as sampled,
	sum(violation_count)                                                   as violations,
	sum(blocked_count)                                                     as blocked,
	round(100.0 * sum(violation_count) / nullif(sum(sampled_count), 0), 3) as violation_pct,
	sum(sampled_count) filter (where role = 'shadow')                      as sampled_as_shadow
from content_filter_hourly_stats
where category = 'all'
	and hour_timestamp >= (now() at time zone 'UTC') - interval '7 days'
group by 1, classifier, internal_scope
order by 1, classifier, internal_scope;

-- Violation reasons per classifier, as a share of that classifier's sampled.
with sampled as (
	select classifier, internal_scope, sum(sampled_count) as sampled
	from content_filter_hourly_stats
	where category = 'all'
		and hour_timestamp >= (now() at time zone 'UTC') - interval '7 days'
	group by classifier, internal_scope
)
select
	s.classifier,
	s.internal_scope,
	c.category,
	sum(c.violation_count)                                                  as violations,
	round(100.0 * sum(c.violation_count) / nullif(max(s.sampled), 0), 3)    as violation_pct
from content_filter_hourly_stats c
join sampled s using (classifier, internal_scope)
where c.category <> 'all'
	and c.hour_timestamp >= (now() at time zone 'UTC') - interval '7 days'
group by s.classifier, s.internal_scope, c.category
order by s.classifier, s.internal_scope, violations desc;
